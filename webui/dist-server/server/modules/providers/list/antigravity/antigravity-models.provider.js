import { buildDefaultProviderCurrentActiveModel } from '../../../../shared/utils.js';
/** Curated Google Antigravity catalog shipped as immutable CloudCLI defaults. */
export const ANTIGRAVITY_PREDEFINED_MODELS = {
    OPTIONS: [
        {
            value: 'gemini-3.8-flash',
            label: 'Gemini 3.8 Flash',
            description: 'Google DeepMind next-generation flagship flash model with deep reasoning.',
            effort: {
                values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                default: 'high',
            },
        },
        {
            value: 'gemini-3.7-flash',
            label: 'Gemini 3.7 Flash',
            description: 'Google DeepMind flagship multimodal model with hybrid reasoning.',
            effort: {
                values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                default: 'high',
            },
        },
        {
            value: 'gemini-3.6-flash',
            label: 'Gemini 3.6 Flash',
            description: 'Fast, cost-effective multimodal model for high-throughput coding tasks.',
            effort: {
                values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                default: 'medium',
            },
        },
        {
            value: 'gemini-3.1-pro',
            label: 'Gemini 3.1 Pro',
            description: 'Deep reasoning for complex code architecture and mathematics.',
            effort: {
                values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                default: 'high',
            },
        },
        {
            value: 'claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6',
            description: 'Anthropic Claude Sonnet 4.6 with reasoning via Google Antigravity.',
        },
        {
            value: 'claude-opus-4-6-thinking',
            label: 'Claude Opus 4.6',
            description: 'Anthropic Claude Opus 4.6 flagship reasoning via Google Antigravity.',
        },
        {
            value: 'gpt-oss-120b-medium',
            label: 'GPT-OSS 120B',
            description: 'High-capability open-weight foundation model via Google Antigravity.',
        },
    ],
    DEFAULT: 'gemini-3.8-flash',
};
export class AntigravityProviderModels {
    async getSupportedModels() {
        return ANTIGRAVITY_PREDEFINED_MODELS;
    }
    async getCurrentActiveModel() {
        return buildDefaultProviderCurrentActiveModel(ANTIGRAVITY_PREDEFINED_MODELS);
    }
}
//# sourceMappingURL=antigravity-models.provider.js.map