// Commands contain placeholders, never the one-time key. POSIX quoting also
// treats configured model IDs as data, rather than shell syntax.
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
export function connectionCommand(provider: string, origin: string, model: string) {
  const base = new URL(origin).origin;
  const read =
    'read -r -s -p "Gateway key: " COMPANY_GATEWAY_API_KEY; printf "\\n"\nexport COMPANY_GATEWAY_API_KEY\n';
  if (provider === 'claude')
    return (
      read +
      `ANTHROPIC_BASE_URL=${quote(base)} ANTHROPIC_AUTH_TOKEN="$COMPANY_GATEWAY_API_KEY" ANTHROPIC_API_KEY= claude --model ${quote(model)}`
    );
  if (provider === 'codex')
    return (
      read +
      'codex \\\n' +
      `  -c ${quote('model_provider="company"')} \\\n` +
      `  -c ${quote('model_providers.company.name="Company Gateway"')} \\\n` +
      `  -c ${quote('model_providers.company.base_url=' + JSON.stringify(base + '/v1'))} \\\n` +
      `  -c ${quote('model_providers.company.env_key="COMPANY_GATEWAY_API_KEY"')} \\\n` +
      `  -c ${quote('model_providers.company.wire_api="responses"')} \\\n` +
      `  -c ${quote('model_providers.company.requires_openai_auth=false')} \\\n` +
      `  -c ${quote('model_providers.company.supports_websockets=false')} \\\n` +
      `  --model ${quote(model)}`
    );
  throw new Error('unsupported_provider');
}
