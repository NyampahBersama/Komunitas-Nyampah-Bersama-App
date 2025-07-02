// supabase/functions/calculate-emission/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Pastikan ada header otorisasi dari Glide untuk verifikasi pengguna
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Authorization header missing' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const token = authHeader.split(' ')[1]

  try {
    const { activity_type, amount, unit } = await req.json() // Contoh input dari Glide

    if (!activity_type || typeof amount === 'undefined' || !unit) {
      return new Response(
        JSON.stringify({ error: 'Activity type, amount, and unit are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const qlimatiqApiKey = Deno.env.get('QLIMATIQ_API_KEY')
    if (!qlimatiqApiKey) {
      return new Response(
        JSON.stringify({ error: 'QLIMATIQ_API_KEY environment variable not set' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Contoh panggilan API Qlimatiq (sesuaikan dengan dokumentasi Qlimatiq)
    const qlimatiqResponse = await fetch('https://beta3.api.qlimatiq.io/co2e', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': qlimatiqApiKey,
      },
      body: JSON.stringify({
        // Ini adalah contoh body, sesuaikan dengan dokumentasi Qlimatiq
        emission_factor: {
            activity_id: activity_type, // Misal 'electricity-consumption', 'plastic-waste'
            source: "GHG_PROTOCOL",
            region: "ID" // Indonesia
        },
        parameters: {
            activity_value: amount,
            activity_unit: unit // Misal 'kWh', 'kg'
        }
      }),
    })

    if (!qlimatiqResponse.ok) {
      const errorData = await qlimatiqResponse.json()
      console.error('Qlimatiq API error:', qlimatiqResponse.status, errorData)
      return new Response(
        JSON.stringify({ error: `Qlimatiq API error: ${errorData.detail || 'Unknown error'}` }),
        { status: qlimatiqResponse.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const qlimatiqData = await qlimatiqResponse.json()
    const co2e = qlimatiqData.co2e || 0; // Ambil nilai emisi CO2e

    // Simpan hasil ke Supabase (misal, tabel `emission_records`)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const { error: insertError } = await supabase.from('emission_records').insert({
        user_id: user.id,
        activity_type: activity_type,
        amount: amount,
        unit: unit,
        co2e_emission: co2e,
      });
      if (insertError) console.error('Error saving emission record:', insertError.message);
    }

    return new Response(
      JSON.stringify({ message: 'Emission calculated successfully!', co2e_emission: co2e }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error in calculate-emission function:', error.message)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

