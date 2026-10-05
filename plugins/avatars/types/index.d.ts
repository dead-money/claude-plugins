/** A per-session setting; null falls back to the plugin's configured default. */
export type Setting = string | null

/** A voice the menu offers. */
export type VoiceChoice = { id: string; name: string }

declare module 'claude-code' {
  interface PluginState {
    avatars: {
      /** The mode whose band shows above the prompt, or false for none. */
      bandMode: string | false
      enabled: Setting
      mode: Setting
      voice: Setting
      model: Setting
      last: Setting
      /** The person's ElevenLabs voices, once the menu has fetched them. */
      voices: VoiceChoice[] | null
      /** A line the menu shows under its controls. */
      note: string
    }
  }
}
