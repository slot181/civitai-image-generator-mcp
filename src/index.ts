#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import pkg from 'civitai'; // Import Civitai SDK using default import
const { Civitai, Scheduler } = pkg; // Destructure needed exports
import { z } from 'zod'; // For input validation
import axios from 'axios'; // For downloading images
import path from 'path'; // For handling file paths
import { mkdir, writeFile, access } from 'fs/promises'; // For directory/file operations
import { constants as fsConstants } from 'fs'; // For access check constants
import { randomUUID } from 'crypto'; // For unique filenames

// Helper function for delaying execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Remove the explicit GenerateImageArgs type definition as it's causing issues.
// Let TypeScript infer the 'params' type in the callback directly from the schema.
// type GenerateImageArgs = z.infer<typeof GenerateImageInputSchema>;

class CivitaiImageGenerationServer {
  private readonly server: McpServer;
  private readonly civitai: InstanceType<typeof Civitai>; // Use InstanceType<typeof Class> for instance type
  private readonly apiKey: string;
  private readonly modelId: string; // Add modelId member
private readonly outputDir: string; // Add outputDir member

constructor(apiKey: string, modelId: string, outputDir: string) { // Add outputDir to constructor
  this.apiKey = apiKey;
  this.modelId = modelId; // Store modelId
  this.outputDir = path.resolve(outputDir); // Store and resolve outputDir
    this.modelId = modelId; // Store modelId

    if (!this.apiKey) {
      throw new Error('CIVITAI_API_TOKEN environment variable is required.');
    }
    if (!this.modelId) { // Add check for modelId
        throw new Error('CIVITAI_MODEL_ID environment variable is required.');
    }

    this.civitai = new Civitai({ auth: this.apiKey });

    this.server = new McpServer(
      {
        name: 'civitai-image-generator',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    // this.server.onerror = (error: unknown) => console.error('[MCP Error]', error); // McpServer might not have onerror
  }

  private setupToolHandlers() {
    this.server.tool(
      'generate_image',
      // Define schema directly - REMOVE 'wait' parameter
      {
        prompt: z.string().describe('Text prompt for image generation'),
        // model parameter removed - will use environment variable
        negativePrompt: z.string().optional().describe('The negative prompt for the image generation'),
        scheduler: z.nativeEnum(Scheduler).optional().default(Scheduler.EULER_A).describe('The scheduler algorithm to use'),
        steps: z.number().int().min(1).max(100).optional().default(20).describe('Number of inference steps (1-100)'),
        cfgScale: z.number().min(1).max(30).optional().default(7).describe('CFG scale for the image generation (1-30)'),
        width: z.number().int().min(64).max(1024).multipleOf(8).optional().default(512).describe('Image width (64-1024, multiple of 8)'),
        height: z.number().int().min(64).max(1024).multipleOf(8).optional().default(768).describe('Image height (64-1024, multiple of 8)'),
        seed: z.number().int().optional().describe('Seed for the image generation process. -1 for random.'),
        clipSkip: z.number().int().min(1).max(10).optional().default(2).describe('Number of CLIP skips (1-10)'),
        additionalNetworks: z.record(z.string(), z.object({ strength: z.number().optional(), triggerWord: z.string().optional() })).optional().describe('Additional networks (LoRA, VAE, etc.) keyed by URN'),
        // 'wait' parameter removed
      },
      // Refactored callback using polling
      async (params) => {
        console.error(`[Civitai MCP] Received generate_image request with prompt: "${params.prompt}"`);

        // Prepare input for Civitai SDK (excluding 'wait')
        const civitaiInput = {
          model: this.modelId, // Use stored modelId from environment variable
          params: {
            prompt: params.prompt,
            negativePrompt: params.negativePrompt,
            scheduler: params.scheduler,
            steps: params.steps,
            cfgScale: params.cfgScale,
            width: params.width,
            height: params.height,
            seed: params.seed ?? -1,
            clipSkip: params.clipSkip,
          },
          additionalNetworks: params.additionalNetworks,
        };

        let initialResponse;
        try {
          console.error('[Civitai MCP] Calling Civitai API (async)...');
          // Always call with wait=false
          initialResponse = await this.civitai.image.fromText(civitaiInput, false);
          console.error('[Civitai MCP] Initial API response:', JSON.stringify(initialResponse, null, 2));

          if (!initialResponse?.token) {
            console.error('[Civitai MCP] Job submission failed or did not return a token.');
            throw new McpError(ErrorCode.InternalError, 'Civitai job submission did not return a token.');
          }

        } catch (error: any) {
          console.error('[Civitai MCP] Initial API Error:', error);
          const errorMessage = error?.message || 'Unknown error submitting job to Civitai API';
          const errorDetails = error?.response?.data ? JSON.stringify(error.response.data) : '';
          return {
            content: [{ type: 'text', text: `Civitai API Error: ${errorMessage}${errorDetails ? ` (${errorDetails})` : ''}` }],
            isError: true,
          };
        }

        const jobToken = initialResponse.token;
        console.error(`[Civitai MCP] Job submitted. Token: ${jobToken}. Starting polling...`);

        // Polling logic
        const pollIntervalMs = 2000; // Poll every 2 seconds
        const timeoutMs = 2 * 60 * 1000; // 2 minute timeout
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
          try {
            console.error(`[Civitai MCP] Polling job status for token: ${jobToken}`);
            const statusResponse = await this.civitai.jobs.getByToken(jobToken);
            console.error('[Civitai MCP] Polling response:', JSON.stringify(statusResponse, null, 2));

            const firstJob = statusResponse?.jobs?.[0];

            if (firstJob?.result?.available) {
              const imageUrl = firstJob.result.blobUrl;
              if (imageUrl) {
                console.error(`[Civitai MCP] Job completed. Image URL: ${imageUrl}`);
                // Download and save the image
                try {
                  const localPath = await this.downloadAndSaveImage(imageUrl);
                  console.error(`[Civitai MCP] Image saved locally to: ${localPath}`);
                  // Return only the path as requested
                  return {
                    content: [{ type: 'text', text: JSON.stringify({ path: localPath }) }],
                  };
                } catch (downloadError: any) {
                   console.error(`[Civitai MCP] Failed to download or save image: ${downloadError.message}`);
                   throw new McpError(ErrorCode.InternalError, `Failed to download or save image from ${imageUrl}: ${downloadError.message}`);
                }
              } else {
                // Job is available but no URL? This might indicate an error state in Civitai.
                 console.error('[Civitai MCP] Job available but blobUrl missing. Treating as error.');
                 throw new McpError(ErrorCode.InternalError, 'Civitai job completed but the result did not contain an image URL.');
              }
            } else if (firstJob && !firstJob.scheduled && !firstJob.result?.available) {
                 // If not scheduled and not available, it might have failed without an explicit error earlier
                 console.error('[Civitai MCP] Job is no longer scheduled but result is not available. Assuming failure.');
                 throw new McpError(ErrorCode.InternalError, 'Civitai job failed or finished without an available result.');
            }

            // If still processing (scheduled or result not available yet), wait and poll again
            console.error('[Civitai MCP] Job still processing, waiting...');
            await delay(pollIntervalMs);

          } catch (pollError: any) {
            // Handle errors during polling itself
            console.error('[Civitai MCP] Polling Error:', pollError);
             // If it's an McpError we threw, re-throw it
            if (pollError instanceof McpError) {
                throw pollError;
            }
            // Otherwise, wrap it
            const errorMessage = pollError?.message || 'Unknown error during job status polling';
             return {
                content: [{ type: 'text', text: `Polling Error: ${errorMessage}` }],
                isError: true,
             };
          }
        }

        // If loop finishes without returning, it's a timeout
        console.error('[Civitai MCP] Polling timed out.');
        // Use InternalError as Timeout is not a standard MCP ErrorCode
        throw new McpError(ErrorCode.InternalError, `Polling timed out: Civitai job did not complete within the ${timeoutMs / 1000} second limit.`);
      }
    );
  }

  // Helper to ensure directory exists
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await access(dirPath, fsConstants.F_OK);
    } catch {
      console.error(`[Civitai MCP] Creating output directory: ${dirPath}`);
      await mkdir(dirPath, { recursive: true });
    }
  }

  // Helper to download and save image
  private async downloadAndSaveImage(imageUrl: string): Promise<string> {
    await this.ensureDirectoryExists(this.outputDir);
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');
    const filename = `civitai_${randomUUID()}.png`; // Use PNG as it's common for Civitai
    const localPath = path.join(this.outputDir, filename);
    await writeFile(localPath, imageBuffer);
    return localPath;
  }


  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Civitai Image Generation MCP server running. Output directory: ${this.outputDir}`);
  }
}

// --- Argument Parsing (Copied from openai-image-mcp) ---
// Helper function to parse arguments in the format "-e KEY VALUE"
function parseCliArgs(argv: string[]): { [key: string]: string } {
  const args = argv.slice(2); // Skip node executable and script path
  const parsed: { [key: string]: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-e' && i + 2 < args.length) {
      const key = args[i + 1];
      const value = args[i + 2];
      parsed[key] = value;
      i += 2; // Move index past the key and value
    }
  }
  return parsed;
}

const cliArgs = parseCliArgs(process.argv);


// --- Configuration Loading ---
// Prioritize command-line args (-e), fall back to environment variables
const API_KEY = cliArgs.CIVITAI_API_TOKEN || process.env.CIVITAI_API_TOKEN;
const MODEL_ID = cliArgs.CIVITAI_MODEL_ID || process.env.CIVITAI_MODEL_ID; // Read MODEL_ID
const OUTPUT_DIR = cliArgs.CIVITAI_OUTPUT_DIR || process.env.CIVITAI_OUTPUT_DIR || './civitai_output'; // Read OUTPUT_DIR with default

if (!API_KEY) {
  console.error('Error: CIVITAI_API_TOKEN environment variable is required.');
  process.exit(1); // Exit if API key is missing
}
if (!MODEL_ID) { // Add check for MODEL_ID
    console.error('Error: CIVITAI_MODEL_ID environment variable is required.');
    process.exit(1); // Exit if Model ID is missing
}
// No need to exit if OUTPUT_DIR is missing, as we have a default.

// Create and run server
const serverInstance = new CivitaiImageGenerationServer(API_KEY, MODEL_ID, OUTPUT_DIR); // Pass MODEL_ID and OUTPUT_DIR
serverInstance.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});