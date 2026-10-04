import { expect, test } from 'bun:test';
import { connectionCommand } from '../src/features/company/connect';

test('setup commands use bearer gateway keys and the native Responses API', () => {
  const claude = connectionCommand('claude', 'https://company.example', 'claude-test');
  expect(claude).toContain('ANTHROPIC_AUTH_TOKEN="$COMPANY_GATEWAY_API_KEY"');
  expect(claude).toContain("ANTHROPIC_BASE_URL='https://company.example'");
  const codex = connectionCommand('codex', 'https://company.example', 'codex-test');
  expect(codex).toContain('model_providers.company.wire_api="responses"');
  expect(codex).toContain('model_providers.company.base_url="https://company.example/v1"');
  expect(codex).toContain('model_providers.company.supports_websockets=false');
  expect(codex).not.toContain('sk-');
  expect(codex).not.toContain('config.toml');
  expect(connectionCommand('codex', 'https://company.example', "model'$(echo bad)")).toContain(
    "'model'\\''$(echo bad)'"
  );
});
