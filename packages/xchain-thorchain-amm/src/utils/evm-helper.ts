import { Protocol, TxHash, XChainClient } from '@xchainjs/xchain-client'
import { ApproveParams, Client as EvmClient, MAX_APPROVAL, abi } from '@xchainjs/xchain-evm'
import { ThorchainCache } from '@xchainjs/xchain-thorchain-query'
import { Asset, BaseAmount, baseAmount, eqAsset, getContractAddressFromAsset } from '@xchainjs/xchain-util'
import { ethers } from 'ethers'

import { DepositParams } from '../types'

const FIFTEEN_MIN_IN_SECS = 15 * 60
export class EvmHelper {
  private evmClient: EvmClient
  private client: XChainClient
  private thorchainCache: ThorchainCache

  constructor(client: XChainClient, thorchainCache: ThorchainCache) {
    this.evmClient = client as unknown as EvmClient
    this.client = client
    this.thorchainCache = thorchainCache
  }

  /**
   * Transaction to THORChain inbound address.
   *
   * @param {DepositParams} params The transaction options.
   * @returns {TxHash} The transaction hash.
   *
   * @throws {"halted chain"} Thrown if chain is halted.
   * @throws {"halted trading"} Thrown if trading is halted.
   * @throws {"amount is not approved"} Thrown if the amount is not allowed to spend
   * @throws {"router address is not defined"} Thrown if router address is not defined
   */
  async sendDeposit(params: DepositParams): Promise<TxHash> {
    const inboundAsgard = (await this.thorchainCache.getInboundDetails())[params.asset.chain]

    if (!inboundAsgard?.router) {
      throw new Error('router address is not defined')
    }
    if (!inboundAsgard?.address) {
      throw new Error('Vault address is not defined')
    }

    const address = await this.client.getAddressAsync(params.walletIndex)
    const gasPrice = await this.evmClient.estimateGasPrices(Protocol.THORCHAIN)

    if (eqAsset(params.asset, this.evmClient.config.gasAsset)) {
      // simple transfer
      return await this.evmClient.transfer({
        walletIndex: params.walletIndex || 0,
        asset: params.asset,
        amount: params.amount,
        recipient: inboundAsgard.address,
        memo: params.memo,
        gasPrice: gasPrice.fast,
      })
    } else {
      //erc-20 must be depsited to the router
      const isApprovedResult = await this.isTCRouterApprovedToSpend(params.asset, params.amount, params.walletIndex)
      if (!isApprovedResult) {
        throw new Error('The amount is not allowed to spend')
      }
      const contractAddress = getContractAddressFromAsset(params.asset)
      const checkSummedContractAddress = ethers.utils.getAddress(contractAddress)
      const latestBlockTimeUnixSecs = (await this.evmClient.getProvider().getBlock('latest')).timestamp
      const expiry = latestBlockTimeUnixSecs + FIFTEEN_MIN_IN_SECS
      const depositParams = [
        inboundAsgard.address,
        checkSummedContractAddress,
        params.amount.amount().toFixed(),
        params.memo,
        expiry,
      ]

      const routerContract = new ethers.Contract(inboundAsgard.router, abi.router)
      const gasLimit = '160000'

      const unsignedTx = await routerContract.populateTransaction.depositWithExpiry(...depositParams, {
        from: address,
        value: 0,
        gasPrice: gasPrice.fast.amount().toFixed(),
        gasLimit: gasLimit,
      })
      const { hash } = await this.evmClient.getWallet(params.walletIndex).sendTransaction(unsignedTx)
      return hash
    }
  }
  async isTCRouterApprovedToSpend(asset: Asset, amount: BaseAmount, walletIndex = 0): Promise<boolean> {
    const router = await this.thorchainCache.getRouterAddressForChain(asset.chain)
    const contractAddress = getContractAddressFromAsset(asset)
    return await this.evmClient.isApproved({
      amount: amount,
      spenderAddress: router,
      contractAddress,
      walletIndex: walletIndex,
    })
  }
  async approveTCRouterToSpend(
    asset: Asset,
    amount = MAX_APPROVAL,
    walletIndex = 0,
  ): Promise<ethers.providers.TransactionResponse> {
    const contractAddress = getContractAddressFromAsset(asset)
    const router = await this.thorchainCache.getRouterAddressForChain(asset.chain)
    const decimals = await this.thorchainCache.midgardQuery.getDecimalForAsset(asset)
    const approveParams: ApproveParams = {
      contractAddress,
      spenderAddress: router,
      amount: baseAmount(amount.toString(), decimals),
      walletIndex,
    }
    return await this.evmClient.approve(approveParams)
  }
}
