import { readFile } from 'node:fs/promises';
import type { NormalizedCodingTaskContract } from './codingTaskContract.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type AntigravityAdapterErrorCode =
  | 'unsupported_model'
  | 'conversation_id_unavailable'
  | 'transcript_unavailable'
  | 'log_file_unreadable';

export class AntigravityAdapterError extends Error {
  public code: AntigravityAdapterErrorCode;

  constructor(message: string, code: AntigravityAdapterErrorCode) {
    super(message);
    this.name = 'AntigravityAdapterError';
    this.code = code;
  }
}

const NATIVE_MODELS = new Set([
  'Gemini 3.1 Pro (High)',
  'Gemini 3.5 Flash (Medium)'
]);

const UUID_REGEX_STRING = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const UUID_REGEX = new RegExp(UUID_REGEX_STRING, 'gi');

export function extractConversationId(logText: string): string {
    const createdPattern = new RegExp(`Created conversation (${UUID_REGEX_STRING})(?![A-Za-z0-9_])`, 'i');
    const conversationPattern = new RegExp(`conversation=(${UUID_REGEX_STRING})(?![A-Za-z0-9_])`, 'i');
    
    const combinedPattern = new RegExp(
        `(?:${createdPattern.source})|(?:${conversationPattern.source})`,
        'gi'
    );

    const matches = logText.match(combinedPattern);

    if (!matches || matches.length === 0) {
        throw new AntigravityAdapterError(
            'Conversation ID not found in Antigravity logs.',
            'conversation_id_unavailable'
        );
    }
    
    const lastMatch = matches[matches.length - 1];
    const uuidMatch = lastMatch.match(UUID_REGEX);
    
    if (!uuidMatch || uuidMatch.length === 0) {
        throw new AntigravityAdapterError(
            'Conversation ID not found in Antigravity logs.',
            'conversation_id_unavailable'
        );
    }

    return uuidMatch[0];
}

export async function readLogFileForConversationId(logFilePath: string): Promise<string> {
  try {
    const content = await readFile(logFilePath, 'utf8');
    return extractConversationId(content);
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === 'ENOENT') {
      throw new AntigravityAdapterError(
        `Log file not found: ${logFilePath}`,
        'transcript_unavailable'
      );
    }
    throw new AntigravityAdapterError(
      `Failed to read log file: ${readError.message}`,
      'log_file_unreadable'
    );
  }
}

async function readTranscriptFile(
  transcriptPath: string
): Promise<{ fileRead: boolean; response: string | null }> {
    const stream = createReadStream(transcriptPath, { encoding: 'utf8' });
    const lines = createInterface({
        input: stream,
        crlfDelay: Infinity,
    });
    let lastResponse: string | null = null;

    try {
        for await (const line of lines) {
            if (!line.trim()) continue;
            try {
                const record = JSON.parse(line);
                if (
                    record.source === 'MODEL' &&
                    record.type === 'PLANNER_RESPONSE' &&
                    record.status === 'DONE' &&
                    typeof record.content === 'string'
                ) {
                    lastResponse = record.content;
                }
            } catch (e) {}
        }
        return { fileRead: true, response: lastResponse };
    } catch (error) {
        const readError = error as NodeJS.ErrnoException;
        if (readError.code === 'ENOENT') {
            return { fileRead: false, response: null };
        }
        throw new AntigravityAdapterError(
            `Failed to read transcript: ${readError.message}`,
            'transcript_unavailable'
        );
    } finally {
        lines.close();
        stream.destroy();
    }
}

export async function readAntigravityResponse(
  conversationId: string,
  homeDir?: string
): Promise<string> {
    const uuidPattern = new RegExp(`^${UUID_REGEX_STRING}$`, 'i');
    if (!uuidPattern.test(conversationId)) {
        throw new AntigravityAdapterError(
            'Invalid conversation ID format.',
            'transcript_unavailable'
        );
    }

    const baseDir = homeDir ?? os.homedir();
    const transcriptDir = path.join(
        baseDir,
        '.gemini',
        'antigravity-cli',
        'brain',
        conversationId,
        '.system_generated',
        'logs'
    );

    const candidatePaths = [
        path.join(transcriptDir, 'transcript_full.jsonl'),
        path.join(transcriptDir, 'transcript.jsonl'),
    ];

    let anyFileExisted = false;

    for (const transcriptPath of candidatePaths) {
        const { fileRead, response } = await readTranscriptFile(transcriptPath);
        anyFileExisted ||= fileRead;

        if (response !== null) {
            return response;
        }
    }

    if (anyFileExisted) {
        throw new AntigravityAdapterError(
            `No valid planner response found for conversation ${conversationId}.`,
            'transcript_unavailable'
        );
    } else {
        throw new AntigravityAdapterError(
            `Transcript for conversation ${conversationId} not found.`,
            'transcript_unavailable'
        );
    }
}

export function resolveAntigravityModel(model: string | undefined): {
  requestedModel: string | undefined;
  resolvedModel: string | undefined;
} {
  if (!model) {
    return { requestedModel: undefined, resolvedModel: undefined };
  }

  if (model === 'gemini-3.5-flash') {
    return { requestedModel: model, resolvedModel: 'Gemini 3.5 Flash (Medium)' };
  }
  if (model === 'Gemini 3.5 Flash (Medium)') {
    return { requestedModel: model, resolvedModel: model };
  }

  if (NATIVE_MODELS.has(model)) {
    return { requestedModel: model, resolvedModel: model };
  }

  throw new AntigravityAdapterError(
    `Unsupported legacy model: ${model}`,
    'unsupported_model'
  );
}

export function buildAntigravityArgs(
  contract: NormalizedCodingTaskContract,
  prompt: string,
  logFile: string
): string[] {
  const args: string[] = [
    '--print',
    prompt,
    '--print-timeout',
    `${contract.timeoutSeconds}s`,
    '--log-file',
    logFile,
  ];

  if (contract.model) {
    const { resolvedModel } = resolveAntigravityModel(contract.model);
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }
  }

  if (contract.mode === 'plan') {
    args.push('--sandbox');
  } else if (contract.mode === 'execute') {
    args.push('--dangerously-skip-permissions');
  }

  return args;
}
