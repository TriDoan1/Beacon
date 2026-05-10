import { SUPPORT_DEFAULT_SYSTEM_PROMPT } from "@paperclipai/shared";

export interface BuildSystemPromptInput {
  productLabel: string;
  customPrompt?: string;
  productKey?: string;
}

export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const template = input.customPrompt?.trim() ? input.customPrompt : SUPPORT_DEFAULT_SYSTEM_PROMPT;
  return template
    .replaceAll("{{PRODUCT_LABEL}}", input.productLabel)
    .replaceAll("{{PRODUCT_KEY}}", input.productKey ?? "");
}
