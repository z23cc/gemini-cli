/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { Config } from '@google/gemini-cli-core';

interface ModelSelectionDialogProps {
  /** Callback function when a model is selected */
  onSelect: (modelName: string) => void;
  /** Callback function when dialog is cancelled */
  onCancel: () => void;
  /** The config object to get current model and available models */
  config: Config;
}

interface ModelItem {
  label: string;
  value: string;
  description?: string;
}

export function ModelSelectionDialog({
  onSelect,
  onCancel,
  config,
}: ModelSelectionDialogProps): React.JSX.Element {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string>('');

  // Handle ESC key to cancel
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  useEffect(() => {
    const loadModels = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const geminiClient = config.getGeminiClient();
        if (!geminiClient) {
          setError('Gemini client not available');
          return;
        }

        const currentModelName = config.getModel();
        setCurrentModel(currentModelName);

        const availableModels = await geminiClient.listAvailableModels();
        
        if (availableModels.length === 0) {
          setError('No models available for your current authentication method');
          return;
        }

        const modelItems: ModelItem[] = availableModels.map((model) => ({
          label: model.displayName || model.name,
          value: model.name,
          description: model.description,
        }));

        setModels(modelItems);
      } catch (err) {
        setError(`Failed to load models: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    };

    loadModels();
  }, [config]);

  const handleModelSelect = (modelName: string) => {
    onSelect(modelName);
  };

  // Find the initial index of the current model
  const initialIndex = models.findIndex((model) => model.value === currentModel);

  if (loading) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>Loading Models...</Text>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Fetching available models...</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.AccentRed}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={Colors.AccentRed}>Error Loading Models</Text>
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Press ESC to close</Text>
        </Box>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>No Models Available</Text>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            No additional models available for your current authentication method.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>Current model: <Text color={Colors.AccentBlue}>{currentModel}</Text></Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Press ESC to close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Select Model</Text>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Current: <Text color={Colors.AccentBlue}>{currentModel}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={models}
          initialIndex={initialIndex >= 0 ? initialIndex : 0}
          onSelect={handleModelSelect}
          isFocused={true}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Use ↑↓ to navigate, Enter to select, ESC to cancel</Text>
      </Box>
    </Box>
  );
}
