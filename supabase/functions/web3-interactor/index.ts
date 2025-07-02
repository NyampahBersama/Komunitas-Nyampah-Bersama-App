// supabase/functions/web3-interactor/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { ethers } from 'https://esm.sh/ethers@6.12.1' // Import ethers.js

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Authorization header missing' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const token = authHeader.split(' ')[1]

  try {
    const { action, payload } = await req.json() // 'action': 'mint_nft', 'claim_airdrop', 'get_balance'

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const privateKey = Deno.env.get('SERVER_WALLET_PRIVATE_KEY') // PRIVATE KEY SERVER (SANGAT SENSITIF)
    const rpcUrl = Deno.env.get('RPC_URL') // Polygon RPC URL, etc.

    if (!supabaseUrl || !supabaseAnonKey || !privateKey || !rpcUrl) {
      return new Response(
        JSON.stringify({ error: 'Web3 environment variables not set' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid user token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const wallet = new ethers.Wallet(privateKey, provider) // Wallet server

    let responseData: any = {}

    switch (action) {
      case 'mint_nft':
        // Payload example: { to_address: "0x...", token_uri: "ipfs://..." }
        // Kontrak NFT ABI (ganti dengan ABI NFT Anda)
        const nftAbi = [
          "function mint(address to, string memory tokenURI) public returns (uint256)",
          // Tambahkan ABI fungsi lain yang relevan
        ]
        const nftContractAddress = payload.contract_address || 'YOUR_NFT_CONTRACT_ADDRESS' // Ganti dengan alamat kontrak NFT Anda
        const nftContract = new ethers.Contract(nftContractAddress, nftAbi, wallet)

        // Memanggil fungsi mint di smart contract
        const tx = await nftContract.mint(payload.to_address, payload.token_uri)
        await tx.wait() // Tunggu transaksi selesai
        responseData = { message: 'NFT Minted!', transactionHash: tx.hash }

        // Simpan ke database Supabase (misal, tabel `user_nfts`)
        await supabase.from('user_nfts').insert({
          user_id: user.id,
          nft_contract_address: nftContractAddress,
          token_id: 'auto_generated_or_from_tx', // Anda perlu cara untuk mendapatkan token_id
          transaction_hash: tx.hash,
        })
        break

      case 'claim_airdrop':
        // Payload example: { airdrop_contract_address: "0x...", user_wallet_address: "0x..." }
        // Kontrak Airdrop ABI
        const airdropAbi = [
          "function claim(address recipient) public",
          // ...ABI lainnya
        ]
        const airdropContractAddress = payload.airdrop_contract_address
        const airdropContract = new ethers.Contract(airdropContractAddress, airdropAbi, wallet)

        const claimTx = await airdropContract.claim(payload.user_wallet_address)
        await claimTx.wait()
        responseData = { message: 'Airdrop Claimed!', transactionHash: claimTx.hash }

        // Simpan ke database Supabase (misal, tabel `user_airdrops_claimed`)
        await supabase.from('user_airdrops_claimed').insert({
          user_id: user.id,
          airdrop_id: payload.airdrop_id, // Dari database airdrop Anda
          user_wallet_address: payload.user_wallet_address,
          transaction_hash: claimTx.hash,
        })
        break

      case 'get_wallet_balance':
        // Payload example: { wallet_address: "0x...", token_contract_address: "0x..." }
        const tokenContractAbi = [
            "function balanceOf(address account) view returns (uint256)"
        ];
        const tokenContractAddress = payload.token_contract_address;
        const tokenContract = new ethers.Contract(tokenContractAddress, tokenContractAbi, provider);
        const balanceBigInt = await tokenContract.balanceOf(payload.wallet_address);
        responseData = { balance: ethers.formatUnits(balanceBigInt, 18) }; // Asumsi 18 desimal
        break;

      default:
        return new Response(JSON.stringify({ error: 'Invalid Web3 action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in web3-interactor function:', error.message)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

