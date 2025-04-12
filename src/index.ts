#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import pkg from 'civitai'; // Import Civitai SDK using default import
const { Civitai, Scheduler } = pkg; // Destructure needed exports
import { z } from 'zod'; // For input validation

// Helper function for delaying execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Remove the explicit GenerateImageArgs type definition as it's causing issues.
// Let TypeScript infer the 'params' type in the callback directly from the schema.
// type GenerateImageArgs = z.infer<typeof GenerateImageInputSchema>;

class CivitaiImageGenerationServer {
  private readonly server: McpServer;
  private readonly civitai: InstanceType<typeof Civitai>; // Use InstanceType<typeof Class> for instance type
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    if (!this.apiKey) {
      throw new Error('CIVITAI_API_TOKEN environment variable is required');
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
        model: z.string().describe('The Civitai model URN to use (e.g., urn:air:sd1:checkpoint:civitai:4201@130072)'),
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
          model: params.model,
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
              if (firstJob.result.blobUrl) {
                console.error(`[Civitai MCP] Job completed. Image URL: ${firstJob.result.blobUrl}`);
                return {
                  content: [{ type: 'text', text: `Image generated: ${firstJob.result.blobUrl}` }],
                };
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

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Civitai Image Generation MCP server running on stdio');
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

if (!API_KEY) {
  console.error('Error: CIVITAI_API_TOKEN environment variable is required.');
  process.exit(1); // Exit if API key is missing
}

// Create and run server
const serverInstance = new CivitaiImageGenerationServer(API_KEY);
serverInstance.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});