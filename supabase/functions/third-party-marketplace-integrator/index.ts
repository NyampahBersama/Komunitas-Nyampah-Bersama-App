// supabase/functions/third-party-marketplace-integrator/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

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
    const { product_name, description, category, weight, price, image_url, target_marketplace } = await req.json()

    if (!product_name || !description || !price || !target_marketplace) {
      return new Response(JSON.stringify({ error: 'Missing required product details' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid user token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let integrationStatus = 'pending'; // Default status
    let externalListingUrl = null;

    switch (target_marketplace) {
      case 'tokopedia':
        // Contoh: Panggil API Tokopedia Seller (jika ada API publik yang memungkinkan listing)
        // KEBANYAKAN MARKETPLACE TIDAK PUNYA API PUBLIK UNTUK LISTING.
        // INI HANYA CONTOH PSEUDOCODE.
        // const tokopediaApiKey = Deno.env.get('TOKOPEDIA_API_KEY');
        // const tokopediaResponse = await fetch('https://api.tokopedia.com/v1/product/create', {
        //   method: 'POST',
        //   headers: { 'Authorization': `Bearer ${tokopediaApiKey}`, 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ name: product_name, description, price, ... })
        // });
        // if (tokopediaResponse.ok) {
        //   integrationStatus = 'listed';
        //   externalListingUrl = (await tokopediaResponse.json()).product_url;
        // } else {
        //   integrationStatus = 'failed';
        //   console.error('Tokopedia API error:', await tokopediaResponse.text());
        // }
        integrationStatus = 'manual_review_required'; // Kemungkinan besar ini yang terjadi
        break;
      case 'internal_marketplace':
        // Jika Anda memiliki marketplace internal di Supabase
        const { error: internalListingError } = await supabase.from('marketplace_items').insert({
            user_id: user.id,
            name: product_name,
            description: description,
            price_nyampahcoin: price, // Asumsi harga dalam NYAMPAHCOIN
            image_url: image_url,
            stock: 1, // Atau sesuai input
            status: 'active'
        });
        if(internalListingError) {
            console.error('Error inserting internal marketplace item:', internalListingError.message);
            integrationStatus = 'failed_internal';
        } else {
            integrationStatus = 'listed_internal';
        }
        break;
      default:
        integrationStatus = 'unsupported_marketplace';
        break;
    }

    // Simpan catatan listing ke database Supabase
    const { error: insertRecordError } = await supabase.from('marketplace_listings').insert({
      user_id: user.id,
      product_name: product_name,
      target_marketplace: target_marketplace,
      status: integrationStatus,
      external_url: externalListingUrl,
    });

    if (insertRecordError) {
      console.error('Error recording marketplace listing:', insertRecordError.message);
    }

    return new Response(
      JSON.stringify({
        message: `Listing process for ${target_marketplace} finished with status: ${integrationStatus}`,
        status: integrationStatus,
        external_url: externalListingUrl
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error in marketplace integrator:', error.message)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
