/**
 * zayvora-bridge.js
 * 
 * Local Intelligence Bridge for Zayvora (Ollama).
 * RAG-Augmented: Routes through the RAG server when available,
 * falls back to direct Ollama calls when it's not.
 */

// The Zayvora 3-Layer Engineering Reasoning Engine API
const RAG_SERVER_URL = process.env.RAG_SERVER_URL || 'http://localhost:8902';

/**
 * Check if the RAG server is running.
 * @returns {Promise<boolean>}
 */
async function isRAGAvailable() {
  try {
    const res = await fetch(`${RAG_SERVER_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Call Zayvora via the RAG server (context-augmented path).
 * @param {string} prompt
 * @returns {Promise<{response: string, sources: Array, contextUsed: boolean}>}
 */
async function callViaRAG(prompt) {
  // Use the /solve endpoint for the 3-Layer Engineering Pipeline
  const res = await fetch(`${RAG_SERVER_URL}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      description: prompt,
      // Default parameters for Layer 3 validation
      result_param_type: "general_engineering",
      expected_magnitude: 1.0
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zayvora Engine Error (${res.status}): ${text}`);
  }

  const data = await res.json();
  
  if (data.status === "REJECTED") {
    return {
      response: `⚠️ **ENGINEERING REJECTION**: ${data.message}\n\n${data.layer_3?.checks?.physics_constraints?.violations?.join('\n') || ''}`,
      sources: [],
      contextUsed: false,
      verificationFailed: true
    };
  }

  return {
    response: data.final_answer?.display_result || data.message || '',
    sources: [],
    contextUsed: true,
    verificationStatus: data.status,
    confidence: data.final_answer?.confidence
  };
}

/**
 * Call Zayvora directly via Ollama (no RAG context).
 * @param {string} prompt
 * @param {object} config
 * @returns {Promise<string>}
 */
async function callDirect(prompt, config) {
  const url = config.ollamaUrl || 'http://localhost:11434/api/generate';
  const model = config.ollamaModel || 'Zayvora';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1, // Technical precision
        num_ctx: 32768,    // Expanded context for Beast-Mode synthesis
        repeat_penalty: 1.1,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama Error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.response || '';
}
/**
 * Detects if the prompt contains Gujarati characters.
 * @param {string} text 
 * @returns {boolean}
 */
function isGujarati(text) {
  const gujaratiRegex = /[\u0A80-\u0AFF]/;
  return gujaratiRegex.test(text);
}

/**
 * Main entry point: calls Zayvora with RAG augmentation when available,
 * falls back to direct Ollama when the RAG server is offline.
 * 
 * @param {string} prompt - The user's question or research query
 * @param {object} config - Bot configuration (ollamaUrl, ollamaModel, etc.)
 * @returns {Promise<string>} - The response text
 */
export async function callZayvora(prompt, config) {
  try {
    const ragAvailable = await isRAGAvailable();

    if (ragAvailable) {
      console.log('[Zayvora] 3-Layer Engine detected — entering deterministic mode');

      const lang = isGujarati(prompt) ? 'gu' : 'en';
      console.log(`[Zayvora] Detected Language: ${lang}`);

      const extractionPrompt = `### TASK: Engineering Problem Extraction
Extract the physics from this problem into a valid JSON schema for the Zayvora Deterministic Engine.

Problem: "${prompt}"

${lang === 'gu' ? '### NOTE: RESPONSE IN MIXED GUJARATI. Use Gujarati for "description" and conversation, but keep ALL technical terms (e.g. Stress, Power, Torque) in English.' : ''}

Required JSON format:
{
  "description": "${lang === 'gu' ? 'Short Mixed-Gujarati summary' : 'Short problem summary'}",
  "inputs": { "var_name": { "value": float, "unit": "string" } },
  "unknowns": ["var_name"],
  "equation": "SymPy-compatible string",
  "result_unit": "SI Unit string",
  "result_param_type": "one_of(temperature_K, pressure_Pa, heat_flux_W_m2, power_W, stress_Pa, etc)",
  "expected_magnitude": float
}
JSON ONLY. NO CHAT. NO EXPLANATION.`;

      const rawExtraction = await callDirect(extractionPrompt, config);
      
      // Clean up Ollama's occasional markdown blocks
      const jsonMatch = rawExtraction.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to extract structured physics from prompt.');
      }
      const problemSchema = JSON.parse(jsonMatch[0]);
      console.log('[Zayvora] Extracted Schema:', JSON.stringify(problemSchema, null, 2));

      // 2. SOLVE: Execute via the 3rd layer Physics Guardian
      const res = await fetch(`${RAG_SERVER_URL}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(problemSchema),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zayvora Engine Error (${res.status}): ${text}`);
      }

      const data = await res.json();
      
    if (data.status === "REJECTED") {
      const violations = data.layer_3?.checks?.physics_constraints?.violations || [];
      const magCheck = data.layer_3?.checks?.magnitude_check;
      let rejectMsg = `⚠️ **ENGINEERING REJECTION**: ${data.message}`;
      if (violations.length > 0) rejectMsg += `\n\n**Violations:**\n• ${violations.join('\n• ')}`;
      if (magCheck && !magCheck.passed) rejectMsg += `\n\n**Magnitude Warning:** Result deviated by ${magCheck.log10_deviation} decades from expectation.`;
      
      return rejectMsg;
    }

      let response = data.final_answer?.display_result || data.message || '';
      if (data.status === "VERIFIED") {
        response = `✅ **VERIFIED ENGINEER RESPONSE**\n\n**Problem:** ${data.final_answer.description}\n**Formula:** ${data.final_answer.equation}\n**Result:** ${response}\n**Confidence:** ${data.final_answer.confidence}\n\n_${data.final_answer.expert_signature}_`;
      }
      return response;
    }

    // STRICT ENFORCEMENT: No direct fallback for engineering queries
    console.log('[Zayvora] 3-Layer Engine offline — blocking unverified response');
    throw new Error('Engineering Reasoning Engine is offline. Cannot provide a verified response.');

  } catch (err) {
    if (err.message.includes('ECONNREFUSED')) {
      throw new Error('Zayvora (Ollama) is not running. Please start your local Ollama app.');
    }
    throw err;
  }
}
