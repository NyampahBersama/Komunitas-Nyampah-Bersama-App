// supabase/functions/sell-waste/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify JWT token from the request header for RLS
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Authorization header missing' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.split(' ')[1] // Bearer [token]

  try {
    const { waste_type, weight_kg } = await req.json()

    if (!waste_type || typeof weight_kg === 'undefined' || weight_kg <= 0) {
      return new Response(
        JSON.stringify({ error: 'Waste type and positive weight are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase environment variables not set' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with the user's JWT token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    })

    // Get the user from the JWT (needed to enforce RLS)
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid user token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const user_id = user.id;

    // Fetch point per unit for the waste type
    const { data: wasteTypeData, error: wasteTypeError } = await supabase
      .from('waste_submission_types')
      .select('point_per_unit')
      .eq('name', waste_type)
      .single();

    if (wasteTypeError || !wasteTypeData) {
      console.error('Error fetching waste type data:', wasteTypeError?.message);
      return new Response(JSON.stringify({ error: 'Invalid waste type or type not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const earnedPoints = wasteTypeData.point_per_unit * weight_kg;

    // Insert into waste_sales table
    const { error: insertError } = await supabase.from('waste_sales').insert({
      user_id: user_id,
      type_of_waste: waste_type,
      weight: weight_kg,
      earned_points: earnedPoints,
    });

    if (insertError) {
      console.error('Error inserting waste sale:', insertError.message);
      return new Response(JSON.stringify({ error: 'Failed to record waste sale' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update user's wallet balance
    const { error: updateBalanceError } = await supabase
      .from('wallet_balances')
      .update({ nyampah_point_balance: Deno.raw`nyampah_point_balance + ${earnedPoints}` })
      .eq('user_id', user_id);

    if (updateBalanceError) {
      console.error('Error updating wallet balance:', updateBalanceError.message);
      // Even if balance update fails, we might still want to acknowledge waste sale
      // depending on business logic. For now, we'll return an error.
      return new Response(
        JSON.stringify({ error: 'Waste recorded, but failed to update balance' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        message: 'Waste recorded and points added successfully!',
        earnedPoints: earnedPoints,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error in sell-waste function:', error.message)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

