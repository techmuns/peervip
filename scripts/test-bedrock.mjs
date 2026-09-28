/**
 * scripts/test-bedrock.mjs — minimal Bedrock connectivity check.
 * Confirms BEDROCK_API_KEY + region + model chain work BEFORE a real run.
 */
import { callClaude, llmConfig } from '../lib/llm.mjs';

const cfg = llmConfig();
console.log(`[test-bedrock] region=${cfg.region} models=${cfg.models.join(', ')}`);

try {
  const reply = await callClaude({ system: 'Reply with exactly: OK', user: 'Say OK.', maxTokens: 16 });
  console.log(`[test-bedrock] reply: ${JSON.stringify(reply.trim())}`);
  console.log('[test-bedrock] SUCCESS');
  process.exit(0);
} catch (err) {
  console.error('[test-bedrock] FAILED');
  console.error(err && err.stack ? err.stack : String(err));
  console.error('\nLikely fixes (GitHub repo secrets):');
  console.error('  BEDROCK_API_KEY   -> a valid Bedrock API key (bearer token)');
  console.error('  BEDROCK_REGION    -> your key\'s region (e.g. us-east-1)');
  console.error('  BEDROCK_MODEL_IDS -> comma list, e.g. "anthropic.claude-sonnet-5,us.anthropic.claude-sonnet-5"');
  process.exit(1);
}
