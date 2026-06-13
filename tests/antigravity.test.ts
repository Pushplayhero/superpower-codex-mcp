
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveAntigravityModel,
  buildAntigravityArgs,
  AntigravityAdapterError,
  extractConversationId,
  readAntigravityResponse,
} from '../src/lib/antigravity.js';
import { normalizeCodingTaskContract } from '../src/lib/codingTaskContract.js';
import type { NormalizedCodingTaskContract } from '../src/lib/codingTaskContract.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Keep track of temp directories to clean up
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0; // Clear the array
});

async function setupMockTranscript(
  conversationId: string,
  homeDir: string,
  fileName: 'transcript.jsonl' | 'transcript_full.jsonl',
  content: string
) {
  const transcriptDir = path.join(
    homeDir,
    '.gemini',
    'antigravity-cli',
    'brain',
    conversationId,
    '.system_generated',
    'logs'
  );
  await fs.mkdir(transcriptDir, { recursive: true });
  await fs.writeFile(path.join(transcriptDir, fileName), content);
  return transcriptDir;
}

describe('antigravity', () => {
  describe('extractConversationId', () => {
    const uuid1 = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    const uuid2 = 'f0e9d8c7-b6a5-4321-fedc-ba9876543210';

    it('should extract conversation ID from "Created conversation <uuid>" pattern', () => {
      const logText = `Some preceding text... Created conversation ${uuid1} and some more.`;
      expect(extractConversationId(logText)).toBe(uuid1);
    });

    it('should extract conversation ID from "conversation=<uuid>" pattern', () => {
      const logText = `[INFO] cli - conversation=${uuid1} - Message`;
      expect(extractConversationId(logText)).toBe(uuid1);
    });

    it('should extract a standard UUID containing uppercase hex digits', () => {
      const uppercaseUuid = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
      expect(extractConversationId(`Created conversation ${uppercaseUuid}`)).toBe(
        uppercaseUuid
      );
    });

    it('should return the last match if multiple IDs are present', () => {
      const logText = `
        verbose: Created conversation ${uuid1}
        more stuff
        [DEBUG] conversation=${uuid2}
        final line
      `;
      expect(extractConversationId(logText)).toBe(uuid2);
    });

    it('should return the last match when patterns are mixed', () => {
        const logText = `
          [DEBUG] conversation=${uuid1}
          more stuff
          verbose: Created conversation ${uuid2}
          final line
        `;
        expect(extractConversationId(logText)).toBe(uuid2);
      });

    it('should throw AntigravityAdapterError if no conversation ID is found', () => {
      const logText = 'Some random log text without any ID.';
      try {
        extractConversationId(logText);
        // This should not be reached
        expect.fail('Expected extractConversationId to throw.');
      } catch (e) {
        expect(e).toBeInstanceOf(AntigravityAdapterError);
        expect((e as AntigravityAdapterError).code).toBe('conversation_id_unavailable');
      }
    });

    it('should not extract a UUID that is a prefix of a longer alphanumeric string', () => {
        const logText = `[INFO] cli - conversation=${uuid1}a - Message`;
        try {
            extractConversationId(logText);
            // This should not be reached if the regex is correct
            expect.fail('Expected extractConversationId to throw for invalid UUID format.');
        } catch (e) {
            expect(e).toBeInstanceOf(AntigravityAdapterError);
            expect((e as AntigravityAdapterError).code).toBe('conversation_id_unavailable');
        }
    });
  });

  describe('readAntigravityResponse', () => {
    const validConversationId = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    const validResponseContent = 'This is the expected planner response.';
    const fullResponseContent = 'This is the FULL response.';

    const validRecord = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: validResponseContent,
    };

    const fullValidRecord = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: fullResponseContent,
      };

    let tempHomeDir: string;

    async function createTempHomeDir() {
        tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-test-'));
        tempDirs.push(tempHomeDir);
        return tempHomeDir;
    }

    it('should read from transcript_full.jsonl if it exists', async () => {
      const home = await createTempHomeDir();
      const transcript = JSON.stringify(fullValidRecord);
      await setupMockTranscript(validConversationId, home, 'transcript_full.jsonl', transcript);

      const response = await readAntigravityResponse(validConversationId, home);
      expect(response).toBe(fullResponseContent);
    });

    it('should prefer transcript_full.jsonl when both transcripts have valid responses', async () => {
        const home = await createTempHomeDir();
        const fullTranscript = JSON.stringify(fullValidRecord);
        const fallbackTranscript = JSON.stringify(validRecord);

        await setupMockTranscript(validConversationId, home, 'transcript_full.jsonl', fullTranscript);
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', fallbackTranscript);

        const response = await readAntigravityResponse(validConversationId, home);
        expect(response).toBe(fullResponseContent); // Full should win
    });

    it('should fall back to transcript.jsonl if transcript_full.jsonl is missing', async () => {
        const home = await createTempHomeDir();
        const transcript = JSON.stringify(validRecord);
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', transcript);

        const response = await readAntigravityResponse(validConversationId, home);
        expect(response).toBe(validResponseContent);
    });

    it('should fall back to transcript.jsonl if transcript_full.jsonl has no valid records', async () => {
      const home = await createTempHomeDir();
      const fallbackContent = 'This is the fallback response.';
      const goodRecord = { ...validRecord, content: fallbackContent };
      const badTranscriptContent = [
        'this is not valid json',
        JSON.stringify({ source: 'USER', type: 'INPUT', content: 'hello' }),
        '{"source": "MODEL", "type": "PLANNER_RESPONSE", "status": "IN_PROGRESS"', // Incomplete
      ].join('\n');
      const goodTranscriptContent = JSON.stringify(goodRecord);

      await setupMockTranscript(validConversationId, home, 'transcript_full.jsonl', badTranscriptContent);
      await setupMockTranscript(validConversationId, home, 'transcript.jsonl', goodTranscriptContent);

      const response = await readAntigravityResponse(validConversationId, home);
      expect(response).toBe(fallbackContent);
    });

    it('should return the content of the LAST valid record', async () => {
        const home = await createTempHomeDir();
        const firstRecord = { ...validRecord, content: 'An older response.' };
        const secondRecord = { ...validRecord, content: 'The final correct response.' };
        const transcript = [
            JSON.stringify(firstRecord),
            JSON.stringify(secondRecord),
        ].join('\n');
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', transcript);

        const response = await readAntigravityResponse(validConversationId, home);
        expect(response).toBe('The final correct response.');
    });

    it('should ignore malformed JSON lines and return a subsequent valid record', async () => {
        const home = await createTempHomeDir();
        const transcript = [
            'this is not valid json',
            JSON.stringify(validRecord),
            '{"source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE"', // Incomplete
        ].join('\n');
        // We put the valid record in the middle. Since it's the only one, it should be returned.
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', transcript);

        const response = await readAntigravityResponse(validConversationId, home);
        expect(response).toBe(validResponseContent);
    });

    it('should ignore records that are not planner responses', async () => {
        const home = await createTempHomeDir();
        const transcript = [
            JSON.stringify({ source: 'USER', type: 'INPUT', content: 'hello' }),
            JSON.stringify(validRecord), // This is the one we want
            JSON.stringify({ source: 'TOOL', type: 'RESPONSE', content: 'tool output' }),
        ].join('\n');
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', transcript);

        const response = await readAntigravityResponse(validConversationId, home);
        expect(response).toBe(validResponseContent);
    });


    it('should throw transcript_unavailable if neither transcript file exists', async () => {
        const home = await createTempHomeDir();
        // Don't create any files
        await expect(
            readAntigravityResponse(validConversationId, home)
        ).rejects.toSatisfy((e: unknown) => {
            return (
                e instanceof AntigravityAdapterError &&
                e.code === 'transcript_unavailable'
            );
        });
    });

    it('should throw transcript_unavailable if transcript exists but has no valid records', async () => {
        const home = await createTempHomeDir();
        const transcript = [
            JSON.stringify({ source: 'USER', type: 'INPUT', content: 'hello' }),
            JSON.stringify({ source: 'TOOL', type: 'RESPONSE', content: 'tool output' }),
        ].join('\n');
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', transcript);

        await expect(
            readAntigravityResponse(validConversationId, home)
        ).rejects.toSatisfy((e: unknown) => {
            return (
                e instanceof AntigravityAdapterError &&
                e.code === 'transcript_unavailable'
            );
        });
    });

    it('should throw transcript_unavailable for an invalid conversation ID format', async () => {
        const home = await createTempHomeDir();
        const invalidId = 'not-a-valid-uuid';
        await expect(readAntigravityResponse(invalidId, home)).rejects.toSatisfy((e: unknown) => {
            return (
                e instanceof AntigravityAdapterError &&
                e.code === 'transcript_unavailable'
            );
        });
    });

    it('should reject ../../escape without reading a transcript outside the brain root', async () => {
        const home = await createTempHomeDir();
        const maliciousId = '../../escape';
        const escapedTranscript = path.resolve(
          home,
          '.gemini',
          'antigravity-cli',
          'brain',
          maliciousId,
          '.system_generated',
          'logs',
          'transcript.jsonl'
        );
        await fs.mkdir(path.dirname(escapedTranscript), { recursive: true });
        await fs.writeFile(escapedTranscript, JSON.stringify(validRecord));

        await expect(readAntigravityResponse(maliciousId, home)).rejects.toSatisfy((e: unknown) => {
            return (
                e instanceof AntigravityAdapterError &&
                e.code === 'transcript_unavailable'
            );
        });
    });

    it('should ignore other unrelated transcripts', async () => {
        // This is implicitly tested by other tests, but we can make it explicit.
        // It should ONLY look for the file matching the provided ID.
        const home = await createTempHomeDir();
        const otherConversationId = 'f0e9d8c7-b6a5-4321-fedc-ba9876543210';
        
        // Setup the correct transcript
        const transcript = JSON.stringify(validRecord);
        await setupMockTranscript(validConversationId, home, 'transcript.jsonl', transcript);

        // Setup an incorrect, but newer, transcript
        const wrongTranscript = JSON.stringify({...validRecord, content: "WRONG CONTENT"});
        const wrongDir = await setupMockTranscript(otherConversationId, home, 'transcript.jsonl', wrongTranscript);

        // Make the wrong one newer
        const now = new Date();
        const past = new Date(Date.now() - 10000);
        await fs.utimes(path.join(wrongDir, 'transcript.jsonl'), now, now);
        const correctDir = path.dirname(path.join(home, '.gemini', 'antigravity-cli', 'brain', validConversationId, '.system_generated', 'logs', 'transcript.jsonl'));
        await fs.utimes(path.join(correctDir, 'transcript.jsonl'), past, past);
        
        const response = await readAntigravityResponse(validConversationId, home);
        expect(response).toBe(validResponseContent); // Should get the right content, not the newer wrong one
    });
  });

  describe('resolveAntigravityModel', () => {
    it('should return undefined for both fields when model is undefined', () => {
      const result = resolveAntigravityModel(undefined);
      expect(result.requestedModel).toBeUndefined();
      expect(result.resolvedModel).toBeUndefined();
    });

    it('should map the Gemini 3.5 legacy id', () => {
      expect(resolveAntigravityModel('gemini-3.5-flash')).toEqual({
        requestedModel: 'gemini-3.5-flash',
        resolvedModel: 'Gemini 3.5 Flash (Medium)'
      });
    });

    it('should accept native label Gemini 3.5 Flash (Medium) without change', () => {
      const nativeModel = 'Gemini 3.5 Flash (Medium)';
      const result = resolveAntigravityModel(nativeModel);
      expect(result.requestedModel).toBe(nativeModel);
      expect(result.resolvedModel).toBe(nativeModel);
    });
    it('should throw AntigravityAdapterError for unknown legacy models', () => {
      const unsupportedModel = 'gemini-3.1-pro-preview';
      try {
        resolveAntigravityModel(unsupportedModel);
        // Should not reach here
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(AntigravityAdapterError);
        const err = e as AntigravityAdapterError;
        expect(err.code).toBe('unsupported_model');
        expect(err.message).toContain(unsupportedModel);
      }
    });
  });

  describe('buildAntigravityArgs', () => {
    const prompt = 'test prompt';
    const logFile = '/tmp/antigravity.log';

    it('should build args for execute mode with a specified model', () => {
      const contract = normalizeCodingTaskContract({
        workspacePath: './',
        prompt: 'test',
        mode: 'execute',
        planApproved: true,
        model: 'Gemini 3.5 Flash (Medium)',
      });

      const expected = [
        '--print',
        prompt,
        '--print-timeout',
        `${contract.timeoutSeconds}s`,
        '--log-file',
        logFile,
        '--model',
        'Gemini 3.5 Flash (Medium)',
        '--dangerously-skip-permissions',
      ];
      const actual = buildAntigravityArgs(contract, prompt, logFile);
      expect(actual).toEqual(expected);
    });

    it('should build args for plan mode, including sandbox and excluding dangerous flag', () => {
        const contract = normalizeCodingTaskContract({
            workspacePath: './',
            prompt: 'test',
            mode: 'plan',
            model: 'Gemini 3.5 Flash (Medium)',
        });

        const expected = [
            '--print',
            prompt,
            '--print-timeout',
            `${contract.timeoutSeconds}s`,
            '--log-file',
            logFile,
            '--model',
            'Gemini 3.5 Flash (Medium)',
            '--sandbox',
        ];
        const actual = buildAntigravityArgs(contract, prompt, logFile);
        expect(actual).toEqual(expected);
    });

    it('should build args excluding --model when contract.model is not specified', () => {
        const contract = normalizeCodingTaskContract({
            workspacePath: './',
            prompt: 'test',
            mode: 'execute',
        planApproved: true,
        });

        const expected = [
            '--print',
            prompt,
            '--print-timeout',
            `${contract.timeoutSeconds}s`,
            '--log-file',
            logFile,
            '--dangerously-skip-permissions',
        ];
        const actual = buildAntigravityArgs(contract, prompt, logFile);
        expect(actual).toEqual(expected);
    });
  });
});
