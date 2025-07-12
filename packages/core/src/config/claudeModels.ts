/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ClaudeModel {
  name: string;
  displayName: string;
  description: string;
  category: 'opus' | 'sonnet' | 'haiku';
  hasThinking: boolean;
  version: string;
}

/**
 * Supported Claude models for Anthropic API
 */
export const CLAUDE_MODELS: ClaudeModel[] = [
  // Opus 4 models
  {
    name: 'claude-opus-4-20250514',
    displayName: 'Claude Opus 4',
    description: 'Most powerful Claude model for complex reasoning and analysis',
    category: 'opus',
    hasThinking: false,
    version: '4.0',
  },
  {
    name: 'claude-opus-4-20250514-thinking',
    displayName: 'Claude Opus 4 (Thinking)',
    description: 'Most powerful Claude model with visible reasoning process',
    category: 'opus',
    hasThinking: true,
    version: '4.0',
  },



  // Sonnet 4 models
  {
    name: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    description: 'Latest Sonnet model with improved capabilities',
    category: 'sonnet',
    hasThinking: false,
    version: '4.0',
  },
  {
    name: 'claude-sonnet-4-20250514-thinking',
    displayName: 'Claude Sonnet 4 (Thinking)',
    description: 'Latest Sonnet model with visible reasoning process',
    category: 'sonnet',
    hasThinking: true,
    version: '4.0',
  },

  // Haiku 3.5 models
  {
    name: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    description: 'Fast and efficient model for quick tasks',
    category: 'haiku',
    hasThinking: false,
    version: '3.5',
  },
];

/**
 * Get all available Claude models
 */
export function getAvailableClaudeModels(): ClaudeModel[] {
  return CLAUDE_MODELS;
}

/**
 * Get Claude models filtered by category
 */
export function getClaudeModelsByCategory(category: 'opus' | 'sonnet' | 'haiku'): ClaudeModel[] {
  return CLAUDE_MODELS.filter(model => model.category === category);
}

/**
 * Get thinking models only
 */
export function getThinkingClaudeModels(): ClaudeModel[] {
  return CLAUDE_MODELS.filter(model => model.hasThinking);
}

/**
 * Get non-thinking models only
 */
export function getNonThinkingClaudeModels(): ClaudeModel[] {
  return CLAUDE_MODELS.filter(model => !model.hasThinking);
}

/**
 * Find a Claude model by name
 */
export function findClaudeModel(name: string): ClaudeModel | undefined {
  return CLAUDE_MODELS.find(model => model.name === name);
}

/**
 * Check if a model name is a valid Claude model
 */
export function isValidClaudeModel(name: string): boolean {
  return CLAUDE_MODELS.some(model => model.name === name);
}

/**
 * Get the default Claude model
 */
export function getDefaultClaudeModel(): ClaudeModel {
  return CLAUDE_MODELS.find(model => model.name === 'claude-sonnet-4-20250514') || CLAUDE_MODELS[0];
}

/**
 * Format Claude models for display in selection UI
 */
export function formatClaudeModelsForSelection(): Array<{ name: string; displayName: string; description?: string }> {
  return CLAUDE_MODELS.map(model => ({
    name: model.name,
    displayName: `${model.displayName}${model.hasThinking ? ' 🧠' : ''}`,
    description: model.description,
  }));
}
