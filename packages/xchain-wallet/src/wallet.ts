/**
 * Import necessary modules and libraries
 */
import { Balance, Network, Tx, TxHash, TxParams, TxsPage, XChainClient } from '@xchainjs/xchain-client'
import { Client as EvmClient, GasPrices, isApproved } from '@xchainjs/xchain-evm'
import { DepositParam, MayachainClient } from '@xchainjs/xchain-mayachain'
import { Address, Asset, BaseAmount, Chain, getContractAddressFromAsset } from '@xchainjs/xchain-util'
import { ethers } from 'ethers'

// Record type to hold network URLs
export type NodeUrls = Record<Network, string>

// Class definition for a Wallet
export class Wallet {
  private clients: Record<Chain, XChainClient>
  private network: Network

  /**
   * Constructor to create a wallet with the desired clients
   *
   * @param {Record<string>} clients Clients mapped by chain with which the wallet works
   * @returns Wallet instance
   */
  constructor(clients: Record<Chain, XChainClient>) {
    this.clients = clients
    this.network = Network.Mainnet

    // Check if clients array is not empty
    if (Object.values(clients).length) {
      // Get the network of the first client
      const network = Object.values(clients)[0].getNetwork()
      // Ensure all clients are on the same network
      if (!Object.values(clients).every((client) => client.getNetwork() === network)) {
        throw Error('Clients not working on the same network')
      }
      this.network = network // Set the network for the wallet
    }
  }

  /**
   * Get the network that the clients are working in
   * @returns {Network} The network
   */
  public getNetwork(): Network {
    return this.network
  }

  /**
   * Set the network that the clients are working in
   * @param {Network} network The Network to set
   */
  public setNetwork(network: Network) {
    // Set network for each client
    Object.values(this.clients).forEach((client) => client.setNetwork(network))
    this.network = network
  }

  /**
   * Add a new client to the wallet
   * @param chain - Chain to add the client for
   * @returns {boolean} True if client is successfully added, otherwise false
   * @throws {Error} If trying to add a client on a different network compared to others
   */
  public addClient(chain: Chain, client: XChainClient): boolean {
    if (chain in this.clients) return false

    const network = client.getNetwork()
    if (!Object.values(this.clients).length) {
      this.network = network
    } else {
      if (this.network !== network)
        throw Error(`Trying to add client in different network. Expected ${this.network} but got ${network}`)
    }

    this.clients[chain] = client
    return true
  }

  /**
   * Purge and remove client from the wallet
   * @param chain Chain to remove the client for
   * @returns {true} True if the client is successfully purged and removed, otherwise false
   */
  public purgeClient(chain: Chain): boolean {
    try {
      const client = this.getClient(chain)
      client.purgeClient()
      delete this.clients[chain]
      return true
    } catch {
      return false
    }
  }

  /**
   * Purge and remove all clients from wallet
   * @returns {boolean} True if the wallet is successfully purged and removed, otherwise false
   */
  public purgeWallet(): boolean {
    try {
      Object.values(this.clients).map((client) => {
        client.purgeClient()
      })
      this.clients = {}
      return true
    } catch {
      return false
    }
  }

  /**
   * Get chain address
   * @param {Chain} chain The chain
   * @returns {string} The chain address
   */
  public async getAddress(chain: Chain): Promise<string> {
    const client = this.getClient(chain)
    return client.getAddressAsync()
  }

  /**
   * Get the wallet chain addresses.
   * @param {Chain[]} chains Optional chains to get addresses for, if not provided, returns all wallet addresses
   * @returns Addresses mapped by chain
   */
  public async getAddresses(chains?: Chain[]): Promise<Record<Chain, Address>> {
    const _chains: Chain[] = chains || Object.keys(this.clients)
    const tasks = _chains.map((chain) => {
      return this.getAddress(chain)
    })

    const walletAddresses: Record<Chain, Address> = {}
    const addresses = await Promise.all(tasks)

    addresses.map((walletAddress, index) => {
      walletAddresses[_chains[index]] = walletAddress
    })

    return walletAddresses
  }

  /**
   * Check if address is valid
   * @param {Chain} chain The chain in which the address has to be valid
   * @param {string} address The address to validate
   * @returns {boolean} true if it is a valid address, otherwise, false
   */
  public validateAddress(chain: Chain, address: string): boolean {
    const client = this.getClient(chain)
    return client.validateAddress(address)
  }

  /**
   * Get chain balances
   * @param {Chain} chain The chain to retrieve the balance of
   * @returns {Balance[]} the chain balances
   */
  public async getBalance(chain: Chain, assets?: Asset[]): Promise<Balance[]> {
    const client = this.getClient(chain)
    return client.getBalance(await client.getAddressAsync(), assets)
  }

  /**
   * By default, it returns all the wallet balances unless assets are provided, in that case,
   * only asset balances will be returned by chain
   * @param {Assets[]} assets - Optional. Assets of which return the balance
   * @returns {Record<Chain, Balance[]>} Balances by chain
   */
  public async getBalances(assets?: Asset[]): Promise<Record<Chain, Balance[]>> {
    const chains: Chain[] = assets ? Array.from(new Set(assets.map((asset) => asset.chain))) : Object.keys(this.clients)

    const tasks = chains.map(async (chain) => {
      return await this.getBalance(
        chain,
        assets?.filter((asset) => asset.chain === chain),
      )
    })

    const walletBalances: Record<Chain, Balance[]> = {}
    const balances = await Promise.all(tasks)

    balances.map((chainBalance, index) => {
      walletBalances[chains[index]] = chainBalance
    })

    return walletBalances
  }

  /**
   * Get transaction data from hash
   * @param {Chain} chain - Chain in which the transaction was done
   * @param {string} hash - Hash of the transaction
   * @returns
   */
  public async getTransactionData(chain: Chain, hash: string): Promise<Tx> {
    const client = this.getClient(chain)
    return await client.getTransactionData(hash)
  }

  /**
   * Returns the transaction history of a chain
   * @param {Chain} chain Chain of which return the transaction history
   * @returns {TxsPage} the chain transaction history
   */
  public async getTransactionsHistory(chain: Chain): Promise<TxsPage> {
    const client = this.getClient(chain)
    return client.getTransactions()
  }

  /**
   * Get wallet histories.
   * By default, it returns all the wallet histories unless chains are provided, in that case,
   * only chain histories will be returned by chain
   * @param {Chain[]} chains - Optional. Chain of which return the transaction history
   * @returns {TxsPage} the chain transaction history
   */
  public async getTransactionsHistories(chains?: Chain[]): Promise<Record<Chain, TxsPage>> {
    const _chains: Chain[] = chains || Object.keys(this.clients)

    const tasks = _chains.map(async (chain) => {
      return this.getTransactionsHistory(chain)
    })

    const walletHistories: Record<Chain, TxsPage> = {}
    const histories = await Promise.all(tasks)

    histories.map((history, index) => {
      walletHistories[_chains[index]] = history
    })

    return walletHistories
  }

  /**
   * Get explorer url
   * @param {Chain} chain The chain to retrieve the explorer of
   * @returns {string} the transaction URL
   */
  public async getExplorerUrl(chain: Chain): Promise<string> {
    const client = this.getClient(chain)
    return client.getExplorerUrl()
  }

  /**
   * Get address URL
   * @param {Chain} chain Chain of the address
   * @param {string} address The address to retrieve the URL of
   * @returns {string} The address URL
   */
  public async getExplorerAddressUrl(chain: Chain, address: string): Promise<string> {
    const client = this.getClient(chain)
    return client.getExplorerAddressUrl(address)
  }

  /**
   * Get transaction URL
   * @param {Chain} chain Chain of the transaction
   * @param {string} hash Hash of the transaction
   * @returns the transaction URL
   */
  public async getExplorerTxUrl(chain: Chain, hash: string): Promise<string> {
    const client = this.getClient(chain)
    return client.getExplorerTxUrl(hash)
  }

  /**
   * Get feeRates. Only available for EVM clients
   * @param {Chain} chain Chain of which return the feeRates
   * @returns {GasPrices} Chain of which return the feeRates
   * @throws {Error} If gas fee rates cannot be returned from the chain
   */
  public async getGasFeeRates(chain: Chain): Promise<GasPrices> {
    const client = this.getClient(chain)
    if (!('estimateGasPrices' in client)) throw Error(`Can not get gas with ${chain} client`)
    return (client as EvmClient).estimateGasPrices()
  }

  /**
   * Make a transaction
   * @param {TxParams} txParams txParams - The parameters to make the transfer
   * @returns The transaction hash
   */
  public async transfer({ asset, amount, recipient, memo, walletIndex }: TxParams & { asset: Asset }): Promise<string> {
    const client = this.getClient(asset.chain)
    return client.transfer({
      walletIndex,
      asset,
      amount,
      recipient,
      memo,
    })
  }

  /**
   * Make a deposit
   * @param {DepositParam} depositParams
   * @returns {string} the hash of the deposit
   * @throws {Error} if cannot make deposit with the asset
   */
  public async deposit({
    asset,
    amount,
    memo,
    walletIndex,
    sequence,
    gasLimit,
  }: DepositParam & { asset: Asset }): Promise<string> {
    const client = this.getClient(asset.chain)
    if (!('deposit' in client)) throw Error(`Can not deposit with ${asset.chain} client`)

    return (client as unknown as MayachainClient).deposit({ asset, amount, memo, walletIndex, sequence, gasLimit })
  }

  /**
   * Check if an spenderAddress is allowed to spend in name of another address certain asset amount
   * @param {Asset} asset The asset to check
   * @param {BaseAmount} amount The amount to check
   * @param {string} fromAddress The owner of the amount asset from
   * @param {string} spenderAddress The spender to check if it is allowed to spend
   * @returns true if the spenderAddress is allowed to spend the amount, otherwise, false
   * @throws {Error} If asset is a non ERC20 asset
   */
  async approve(
    asset: Asset,
    amount: BaseAmount,
    spenderAddress: string,
  ): Promise<ethers.providers.TransactionResponse> {
    const client = this.getClient(asset.chain)
    if (!('approve' in client)) throw Error('Can not make approve over non EVM client')
    if (asset.chain === asset.ticker) throw Error('Can not make approve over native asset')

    const contractAddress = getContractAddressFromAsset(asset)

    return await (client as EvmClient).approve({ contractAddress, amount, spenderAddress })
  }

  /**
   * Check if an spenderAddress is allowed to spend in name of another address certain asset amount
   * @param {Asset} asset The asset to check
   * @param {BaseAmount} amount The amount to check
   * @param {string} fromAddress oThe wner of the amount asset from
   * @param {string} spenderAddress Spender to check if it is allowed to spend
   * @returns true if the spenderAddress is allowed to spend the amount, otherwise, false
   * @throws {Error} If asset is a non ERC20 asset
   */
  async isApproved(asset: Asset, amount: BaseAmount, fromAddress: string, spenderAddress: string): Promise<boolean> {
    const client = this.getClient(asset.chain)
    if (!('isApproved' in client)) throw Error('Can not validate approve over non EVM client')
    if (asset.chain === asset.ticker) throw Error('Can not validate approve over native asset')

    const contractAddress = getContractAddressFromAsset(asset)

    return isApproved({
      provider: (client as EvmClient).getProvider(),
      amount,
      spenderAddress,
      contractAddress,
      fromAddress,
    })
  }

  /**
   * Broadcast transaction
   * @param {Chain} chain The chain in which broadcast the signed raw transaction
   * @param {string} txHex signed raw transaction
   * @returns {TxHash} the broadcasted transaction hash
   */
  public async broadcast(chain: Chain, txHex: string): Promise<TxHash> {
    const client = this.getClient(chain)
    return client.broadcastTx(txHex)
  }
  /**
   * Get chain wallet. Only available for EVM clients
   * @param {Chain} chain of which return the wallet
   * @returns {ethers.Wallet} the chain wallet
   * @throws {Error} wallet can not be retrieve from chain
   */
  public getChainWallet(chain: Chain): ethers.Wallet {
    const client = this.getClient(chain)
    if (!('getWallet' in client)) throw Error(`Can not get wallet of ${chain} client`)
    return (client as EvmClient).getWallet()
  }

  /**
   * Get chain client
   * @param {Chain} chain The chain of which to return the client
   * @returns {XChainClient} The chain client
   * @throws {Error} If the client does not exist
   */
  private getClient(chain: Chain): XChainClient {
    const client = this.clients[chain]
    if (!client) throw Error(`Client not found for ${chain} chain`)
    return client
  }
}
