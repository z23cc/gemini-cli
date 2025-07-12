/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  Candidate,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import { ContentGenerator, ContentGeneratorConfig } from '../core/contentGenerator.js';

/**
 * Helper function to normalize ContentListUnion to Content array
 */
function normalizeContents(contents: any): Content[] {
  if (!contents) return [];

  // If it's already an array of Content objects
  if (Array.isArray(contents)) {
    return contents.filter((item: any) => item && typeof item === 'object' && 'parts' in item);
  }

  // If it's a single Content object
  if (typeof contents === 'object' && 'parts' in contents) {
    return [contents];
  }

  // If it's a string or PartUnion, convert to Content
  if (typeof contents === 'string') {
    return [{ parts: [{ text: contents }], role: 'user' }];
  }

  // If it's a Part object
  if (typeof contents === 'object' && ('text' in contents || 'inlineData' in contents)) {
    return [{ parts: [contents], role: 'user' }];
  }

  return [];
}

/**
 * Anthropic Claude API content generator
 */
export class AnthropicContentGenerator implements ContentGenerator {
  constructor(private config: ContentGeneratorConfig) {}

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const anthropicRequest = this.convertToAnthropicFormat(request);
    
    const baseUrl = this.config.baseUrl?.endsWith('/v1') ? this.config.baseUrl : `${this.config.baseUrl}/v1`;
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
        ...this.config.customHeaders,
      },
      body: JSON.stringify(anthropicRequest),
      signal: this.config.timeout ? AbortSignal.timeout(this.config.timeout) : undefined,
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorData = await response.json();
        errorDetails = JSON.stringify(errorData);
      } catch (e) {
        errorDetails = await response.text();
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}. Details: ${errorDetails}`);
    }

    const data = await response.json();
    const result = this.convertFromAnthropicFormat(data);
    if (!result) {
      throw new Error('Failed to convert Anthropic response');
    }
    return result;
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return this.generateContentStreamInternal(request);
  }

  private async *generateContentStreamInternal(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    const anthropicRequest = {
      ...this.convertToAnthropicFormat(request),
      stream: true
    };

    const baseUrl = this.config.baseUrl?.endsWith('/v1') ? this.config.baseUrl : `${this.config.baseUrl}/v1`;
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
        ...this.config.customHeaders,
      },
      body: JSON.stringify(anthropicRequest),
      signal: this.config.timeout ? AbortSignal.timeout(this.config.timeout) : undefined,
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorData = await response.json();
        errorDetails = JSON.stringify(errorData);
      } catch (e) {
        errorDetails = await response.text();
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}. Details: ${errorDetails}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Track accumulated tool call inputs for streaming
    const toolCallAccumulator = new Map<string, {
      id: string;
      name: string;
      input: string;
    }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data);
              const geminiResponse = this.convertFromAnthropicFormat(parsed, true, toolCallAccumulator);
              if (geminiResponse) {
                yield geminiResponse;
              }
            } catch (e) {
              // Skip invalid JSON - this is expected for some Anthropic streaming events
              // Don't log this as it's normal behavior
            }
          }
        }
      }

      // Process any accumulated tool calls at the end
      if (toolCallAccumulator.size > 0) {
        const completedToolCalls = Array.from(toolCallAccumulator.values());
        const geminiResponse = this.convertAccumulatedAnthropicToolCallsToGemini(completedToolCalls);
        if (geminiResponse) {
          yield geminiResponse;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Anthropic doesn't provide token counting API, so approximate
    const contents = normalizeContents(request.contents);
    const text = this.extractTextFromContents(contents);
    const approximateTokens = Math.ceil(text.length / 4);

    return {
      totalTokens: approximateTokens,
    };
  }

  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Anthropic does not support embeddings');
  }

  private convertToAnthropicFormat(request: GenerateContentParameters): any {
    const contents = normalizeContents(request.contents);

    // For Anthropic, convert tool results to text summaries to avoid conversation structure issues
    // This happens because the CLI doesn't maintain proper conversation continuity for tool calling
    const processedContents = this.convertToolResultsToTextForAnthropic(contents);

    return this.convertContentsToAnthropicMessages(processedContents, request);
  }

  private convertToolResultsToTextForAnthropic(contents: any[]): any[] {
    return contents.map(content => {
      if (content.role === 'user' && content.parts?.some((part: any) => 'functionResponse' in part)) {
        // This message contains tool results - convert them to readable text
        const textParts: any[] = [];
        const toolResults: any[] = [];

        // Separate text parts from tool results
        for (const part of content.parts) {
          if ('functionResponse' in part && part.functionResponse) {
            toolResults.push(part);
          } else if ('text' in part && part.text) {
            textParts.push(part);
          }
        }

        // If there are tool results, convert them to text
        if (toolResults.length > 0) {
          let summaryText = '';

          // Add any existing text first
          if (textParts.length > 0) {
            summaryText = textParts.map(p => p.text).join('\n') + '\n\n';
          }

          summaryText += '## Tool Execution Completed\n\n';
          summaryText += 'The following tools have been executed successfully:\n\n';

          for (const part of toolResults) {
            if ('functionResponse' in part && part.functionResponse) {
              const response = typeof part.functionResponse.response === 'string'
                ? part.functionResponse.response
                : JSON.stringify(part.functionResponse.response, null, 2);

              summaryText += `### ${part.functionResponse.name}\n`;
              summaryText += '```\n';
              summaryText += response;
              summaryText += '\n```\n\n';
            }
          }

          summaryText += '**Task completed successfully.** Please provide a summary of these results and any insights.';

          // Return the message with converted text
          return {
            ...content,
            parts: [{ text: summaryText }]
          };
        }
      }

      return content;
    });
  }

  private convertContentsToAnthropicMessages(contents: any[], request: GenerateContentParameters): any {
    let processedContents = contents;

    // Handle JSON generation requests by modifying the first user message
    if (request.config?.responseMimeType === 'application/json' && request.config?.responseSchema) {
      const jsonInstruction = `You must respond with valid JSON only. No additional text, explanations, or formatting. The response must conform to this schema: ${JSON.stringify(request.config.responseSchema)}`;

      // Find the first user message and prepend the JSON instruction
      processedContents = contents.map((content, index) => {
        if (index === 0 && content.role === 'user' && content.parts) {
          return {
            ...content,
            parts: [
              { text: jsonInstruction },
              ...content.parts
            ]
          };
        }
        return content;
      });
    }

    const messages = processedContents.map((content: Content) => {
      const anthropicContent: any[] = [];

      if (content.parts) {
        for (const part of content.parts) {
          if ('text' in part && part.text) {
            anthropicContent.push({ type: 'text', text: part.text });
          } else if ('functionResponse' in part && part.functionResponse) {
            // Note: functionResponse parts should have been converted to text by convertToolResultsToTextForAnthropic
            // If reach here, it means the conversion didn't happen - fallback to text
            const response = typeof part.functionResponse.response === 'string'
              ? part.functionResponse.response
              : JSON.stringify(part.functionResponse.response);
            anthropicContent.push({
              type: 'text',
              text: `Tool result from ${part.functionResponse.name}: ${response}`
            });
          } else if ('functionCall' in part && part.functionCall) {
            // Convert Gemini functionCall to Anthropic tool_use format (for assistant messages)
            anthropicContent.push({
              type: 'tool_use',
              id: part.functionCall.id,
              name: part.functionCall.name,
              input: part.functionCall.args || {}
            });
          } else {
            // Fallback for other part types
            anthropicContent.push({ type: 'text', text: JSON.stringify(part) });
          }
        }
      }

      // Ensure messages have valid content
      if (anthropicContent.length === 0) {
        // Skip empty messages entirely
        return null;
      }

      // Ensure user messages have at least some text content if they only have tool_result
      if (content.role === 'user' && anthropicContent.length > 0) {
        const hasText = anthropicContent.some(item => item.type === 'text' && item.text?.trim());
        const hasToolResult = anthropicContent.some(item => item.type === 'tool_result');

        if (!hasText && hasToolResult) {
          // Add minimal text content for tool result messages
          anthropicContent.unshift({ type: 'text', text: 'Here are the tool results:' });
        }
      }

      return {
        role: content.role === 'model' ? 'assistant' : 'user',
        content: anthropicContent
      };
    }).filter(message => message !== null);

    const anthropicRequest: any = {
      model: request.model || this.config.model,
      messages,
      max_tokens: request.config?.maxOutputTokens || 2048,
      temperature: request.config?.temperature || 0.7,
      top_p: request.config?.topP || 1,
    };

    // Convert Gemini tools to Anthropic format
    if (request.config?.tools && request.config.tools.length > 0) {
      const anthropicTools: any[] = [];

      for (const tool of request.config.tools) {
        if ('functionDeclarations' in tool && tool.functionDeclarations) {
          for (const funcDecl of tool.functionDeclarations) {
            anthropicTools.push({
              name: funcDecl.name,
              description: funcDecl.description || '',
              input_schema: funcDecl.parameters || { type: 'object', properties: {} },
            });
          }
        }
      }

      if (anthropicTools.length > 0) {
        anthropicRequest.tools = anthropicTools;
      }
    }

    return anthropicRequest;
  }

  private convertFromAnthropicFormat(
    data: any,
    isStream = false,
    toolCallAccumulator?: Map<string, { id: string; name: string; input: string }>
  ): GenerateContentResponse | null {
    // Handle streaming events
    if (isStream) {
      return this.handleAnthropicStreamingEvent(data, toolCallAccumulator);
    }

    // Handle non-streaming response
    let text = '';
    const functionCalls: any[] = [];

    // Extract text and tool calls from content array
    if (data.content && Array.isArray(data.content)) {
      for (const contentBlock of data.content) {
        if (contentBlock.type === 'text') {
          text += contentBlock.text || '';
        } else if (contentBlock.type === 'tool_use') {
          functionCalls.push({
            id: contentBlock.id,
            name: contentBlock.name,
            args: contentBlock.input || {},
          });
        }
      }
    }

    const candidate: Candidate = {
      content: {
        parts: [{ text }],
        role: 'model',
      },
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' as any : data.stop_reason || 'STOP',
      index: 0,
    };

    const usageMetadata: GenerateContentResponseUsageMetadata = {
      promptTokenCount: data.usage?.input_tokens || 0,
      candidatesTokenCount: data.usage?.output_tokens || 0,
      totalTokenCount: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };

    return {
      candidates: [candidate],
      usageMetadata,
      text: text,
      data: undefined,
      functionCalls,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  private handleAnthropicStreamingEvent(
    data: any,
    toolCallAccumulator?: Map<string, { id: string; name: string; input: string }>
  ): GenerateContentResponse | null {
    // Handle different streaming event types
    if (data.type === 'content_block_delta') {
      if (data.delta?.type === 'text_delta') {
        // Handle text streaming
        const text = data.delta.text || '';
        return this.createStreamingTextResponse(text);
      } else if (data.delta?.type === 'input_json_delta' && toolCallAccumulator) {
        // Handle tool call input streaming - accumulate partial JSON
        const blockIndex = data.index || 0;
        const partialJson = data.delta.partial_json || '';

        // Find the tool call by index (need to track this from content_block_start)
        const indexKey = `index_${blockIndex}`;
        for (const [key, accumulated] of toolCallAccumulator.entries()) {
          if (key === indexKey) {
            accumulated.input += partialJson;
            break;
          }
        }

        // Don't yield during accumulation
        return null;
      }
    } else if (data.type === 'content_block_start' && toolCallAccumulator) {
      // Handle tool call start
      if (data.content_block?.type === 'tool_use') {
        const toolCall = data.content_block;
        const blockIndex = data.index || 0;
        const indexKey = `index_${blockIndex}`;

        toolCallAccumulator.set(indexKey, {
          id: toolCall.id,
          name: toolCall.name,
          input: '',
        });

        return null;
      }
    } else if (data.type === 'message_stop') {
      // End of message - don't yield anything here, let the caller handle accumulated tool calls
      return null;
    }

    return null;
  }

  private createStreamingTextResponse(text: string): GenerateContentResponse {
    const candidate: Candidate = {
      content: {
        parts: [{ text }],
        role: 'model',
      },
      finishReason: 'STOP' as any,
      index: 0,
    };

    return {
      candidates: [candidate],
      usageMetadata: {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
      },
      text: text,
      data: undefined,
      functionCalls: [],
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  private convertAccumulatedAnthropicToolCallsToGemini(
    toolCalls: Array<{ id: string; name: string; input: string }>
  ): GenerateContentResponse | null {
    const functionCalls: any[] = [];

    for (const toolCall of toolCalls) {
      try {
        const args = toolCall.input ? JSON.parse(toolCall.input) : {};
        functionCalls.push({
          id: toolCall.id,
          name: toolCall.name,
          args: args,
        });
      } catch (e) {
        // Failed to parse accumulated tool call input - this can happen with malformed JSON
        // Include the tool call with empty args if parsing fails
        functionCalls.push({
          id: toolCall.id,
          name: toolCall.name,
          args: {},
        });
      }
    }

    if (functionCalls.length === 0) {
      return null;
    }

    const candidate: Candidate = {
      content: {
        parts: [{ text: '' }],
        role: 'model',
      },
      finishReason: 'tool_calls' as any,
      index: 0,
    };

    return {
      candidates: [candidate],
      usageMetadata: {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
      },
      text: '',
      data: undefined,
      functionCalls,
      executableCode: undefined,
      codeExecutionResult: undefined,
    };
  }

  private extractTextFromContents(contents: Content[]): string {
    return contents
      .map(content =>
        content.parts
          ?.map((part: Part) => ('text' in part ? part.text : ''))
          .join(' ') || ''
      )
      .join(' ');
  }
}