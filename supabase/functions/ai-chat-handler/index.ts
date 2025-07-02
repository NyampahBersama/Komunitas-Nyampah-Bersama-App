// supabase/functions/ai-chat-handler/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// For OpenAI API
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-3.5-turbo' // or 'gpt-4o', 'gpt-4-turbo', etc.

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
  const token = authHeader.split(' ')[1]

  try {
    const { user_id, message } = await req.json()

    if (!user_id || !message) {
      return new Response(
        JSON.stringify({ error: 'user_id and message are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY') // Ensure this env var is set in Supabase dashboard

    if (!supabaseUrl || !supabaseAnonKey || !openAiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Required environment variables not set' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    })

    // 1. Save user's message to chat history
    const { error: insertUserMsgError } = await supabase.from('chat_history').insert({
      user_id: user_id,
      message_text: message,
      sender: 'user',
      // You might add a session_id here if you track multiple conversations
    })

    if (insertUserMsgError) {
      console.error('Error inserting user message:', insertUserMsgError.message)
      return new Response(
        JSON.stringify({ error: 'Failed to record user message' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 2. Fetch recent chat history for context
    const { data: history, error: fetchHistoryError } = await supabase
      .from('chat_history')
      .select('message_text, sender')
      .eq('user_id', user_id)
      .order('timestamp', { ascending: false })
      .limit(10) // Fetch last 10 messages for context

    if (fetchHistoryError) {
      console.error('Error fetching chat history:', fetchHistoryError.message)
      // Continue without history if fetching fails, or return error
    }

    const messages = (history || [])
      .map((msg) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.message_text,
      }))
      .reverse() // Reverse to get chronological order
      .concat([{ role: 'user', content: message }]) // Add current message

    // Add a system message for initial context/persona
    messages.unshift({
      role: 'system',
      content: 'You are Nymampah AI Assistant, focused on waste management, recycling, and environmental awareness. Be helpful and encouraging.',
    });

    // 3. Call OpenAI API
    const openaiResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: messages,
        temperature: 0.7, // Creativity level
        max_tokens: 200,  // Max length of AI response
      }),
    })

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json()
      console.error('OpenAI API error:', openaiResponse.status, errorData)
      return new Response(
        JSON.stringify({ error: `AI service error: ${errorData.error?.message || 'Unknown error'}` }),
        { status: openaiResponse.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const openaiData = await openaiResponse.json()
    const aiResponseText = openaiData.choices[0]?.message?.content || 'Maaf, saya tidak bisa merespons saat ini.'

    // 4. Save AI's response to chat history
    const { error: insertAiMsgError } = await supabase.from('chat_history').insert({
      user_id: user_id,
      message_text: aiResponseText,
      sender: 'ai',
      // You might add a session_id here
    })

    if (insertAiMsgError) {
      console.error('Error inserting AI message:', insertAiMsgError.message)
      // Even if AI response fails to save, we might still send it to user
    }

    return new Response(
      JSON.stringify({ reply: aiResponseText }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error in AI chat handler:', error.message)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

