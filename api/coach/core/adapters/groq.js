/* Groq — OpenAI's Chat Completions wire shape at api.groq.com/openai.
 *
 * Same POST /v1/chat/completions contract OpenAI does (bearer auth, `model`, `messages`), so
 * the request shape is chatCompletionsSpec's and the transport is httpAdapter's. The base URL
 * carries the /openai segment (core/providers.js), so the spec's /v1/… paths land on the live
 * endpoint as-is.
 */
import { httpAdapter } from './http.js'
import { chatCompletionsSpec } from './openai.js'

/* `max_tokens`, not `max_completion_tokens`: Groq's documented field (both were tested against
 * the live API and work). temperature 0: a plan diff wants determinism — the same stance
 * compatible.js and grok.js take. No process-env merging, unlike grok.js: GROQ_API_KEY arrives
 * through the normal env channel exactly like OPENAI_API_KEY. */
export const groqSpec = chatCompletionsSpec('groq', { maxTokensField: 'max_tokens', temperature: 0 })
export default httpAdapter(groqSpec)
