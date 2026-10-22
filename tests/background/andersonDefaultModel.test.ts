import { describe, expect, it, vi } from 'vitest';
import { applyAndersonDefaultModel } from '../../apps/extension/src/background/settings/andersonDefaultModel';
import { createExtensionSettingsRepository } from '../../apps/extension/src/background/extensionControl/settingsRepository';
import { normalizeSettings } from '../../apps/extension/src/shared/config';

describe('Anderson default model migration', () => {
  it('applies GPT-5 mini once while retaining API credentials and future manual choices', async () => {
    let state = { settings: normalizeSettings({ translator: 'llm', llmProvider: 'openai', llmProfiles: {
      openai: { authMode: 'api_key', modelPreset: 'gpt-4o-mini', apiKey: 'synthetic-key' },
    } }), revision: 1 };
    const repository = createExtensionSettingsRepository({ readState: async () => state, writeState: async (next) => { state = next; } });
    let migrated = false;
    const storage = { get: vi.fn(async () => migrated), set: vi.fn(async (_key: string, _value: unknown) => { migrated = true; }) };
    expect(await applyAndersonDefaultModel(repository, storage)).toBe(true);
    expect(state.settings.llmProfiles.openai).toMatchObject({ modelPreset: 'gpt-5-mini', authMode: 'api_key', apiKey: 'synthetic-key' });
    await repository.update((settings) => ({ ...settings, llmProfiles: { ...settings.llmProfiles, openai: { ...settings.llmProfiles.openai, modelPreset: 'gpt-4.1' } } }));
    expect(await applyAndersonDefaultModel(repository, storage)).toBe(false);
    expect(state.settings.llmProfiles.openai.modelPreset).toBe('gpt-4.1');
    expect(storage.set).toHaveBeenCalledOnce();
  });
});
