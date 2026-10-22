import type { ExtensionSettingsRepository } from '../extensionControl/settingsRepository';
import { storageGet, storageSet } from '../storage/chromeStorage';

const migrationKey = 'anderson.pdf.default-gpt5-mini.v1';
/** Apply the user's requested model once; later manual model selections survive. */
export async function applyAndersonDefaultModel(
  repository: ExtensionSettingsRepository,
  storage = { get: storageGet, set: storageSet },
): Promise<boolean> {
  if (await storage.get(migrationKey)) return false;
  await repository.update((settings) => ({ ...settings, llmProfiles: {
    ...settings.llmProfiles, openai: { ...settings.llmProfiles.openai,
      modelPreset: 'gpt-5-mini', useCustomModel: false, authMode: 'api_key',
    },
  } }));
  await storage.set(migrationKey, true);
  return true;
}
