#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import pkg from 'civitai'; // Import Civitai SDK using default import
const { Civitai, Scheduler } = pkg; // Destructure needed exports
import { z } from 'zod'; // For input validation

// Define the input type directly from the inline schema in server.tool
// (We need the type definition even if the schema constant is removed)
type GenerateImageArgs = z.infer<z.ZodObject<{
  prompt: z.ZodString;
  model: z.ZodString;
  negativePrompt: z.ZodOptional<z.ZodString>;
  scheduler: z.ZodDefault<z.ZodOptional<z.ZodNativeEnum<typeof Scheduler>>>;
  steps: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
  cfgScale: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
  width: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
  height: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
  seed: z.ZodOptional<z.ZodNumber>;
  clipSkip: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
  additionalNetworks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
      strength: z.ZodOptional<z.ZodNumber>;
      triggerWord: z.ZodOptional<z.ZodString>;
  }, "strip", z.ZodTypeAny, { strength?: number | undefined; triggerWord?: string | undefined; }, { strength?: number | undefined; triggerWord?: string | undefined; }>>>;
  wait: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, { prompt: string; model: string; negativePrompt?: string | undefined; scheduler: Scheduler; steps: number; cfgScale: number; width: number; height: number; seed?: number | undefined; clipSkip: number; additionalNetworks?: Record<string, { strength?: number | undefined; triggerWord?: string | undefined; }> | undefined; wait: boolean; }, { prompt: string; model: string; negativePrompt?: string | undefined; scheduler?: Scheduler | undefined; steps?: number | undefined; cfgScale?: number | undefined; width?: number | undefined; height?: number | undefined; seed?: number | undefined; clipSkip?: number | undefined; additionalNetworks?: Record<string, { strength?: number | undefined; triggerWord?: string | undefined; }> | undefined; wait?: boolean | undefined; }>>;

// Type for validated arguments - Now defined above using z.infer on the inline shape
// type GenerateImageArgs = z.infer<typeof GenerateImageInputSchema>;

class CivitaiImageGenerationServer {
  private readonly server: McpServer;
  private readonly civitai: Civitai;
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
      // Define schema directly as an object literal (ZodRawShape)
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
        wait: z.boolean().optional().default(true).describe('Wait for the job to complete before returning (long polling)')
      },
      async (params: GenerateImageArgs) => {
        console.error(`[Civitai MCP] Received generate_image request with prompt: "${params.prompt}"`); // Log request start

        const { wait, ...inputParams } = params; // Separate 'wait' from API params

        try {
          // Prepare input for Civitai SDK
          const civitaiInput = {
            model: inputParams.model,
            params: {
              prompt: inputParams.prompt,
              negativePrompt: inputParams.negativePrompt,
              scheduler: inputParams.scheduler,
              steps: inputParams.steps,
              cfgScale: inputParams.cfgScale,
              width: inputParams.width,
              height: inputParams.height,
              seed: inputParams.seed ?? -1, // Default seed to -1 if not provided
              clipSkip: inputParams.clipSkip,
            },
            additionalNetworks: inputParams.additionalNetworks,
            // controlNets: inputParams.controlNets, // Add later if needed
            // quantity: inputParams.batchSize, // Map batchSize to quantity if needed
          };

          console.error('[Civitai MCP] Calling Civitai API...');
          const response = await this.civitai.image.fromText(civitaiInput, wait); // response type depends on 'wait'
          console.error('[Civitai MCP] Received API response:', JSON.stringify(response, null, 2));

          if (wait) {
            // If waited, assume 'response' is the completed job object (or array if batch > 1)
            // For now, assume batchSize is 1, so response is a single job object.
            // TODO: Verify the actual return structure for wait=true from Civitai SDK.
            const jobResult = response as any; // Cast to any for now due to uncertainty

            if (jobResult?.result?.available && jobResult.result.blobUrl) {
               console.error(`[Civitai MCP] Job completed. Image URL: ${jobResult.result.blobUrl}`);
              return {
                content: [{ type: 'text', text: `Image generated: ${jobResult.result.blobUrl}` }],
              };
            } else {
              // Attempt to check if it's an array (batch > 1 case)
              const firstJobInArray = Array.isArray(response) ? response[0] : null;
              if (firstJobInArray?.result?.available && firstJobInArray.result.blobUrl) {
                 console.error(`[Civitai MCP] Job completed (batch). Image URL: ${firstJobInArray.result.blobUrl}`);
                 // Note: Returning only the first image URL for now if batch > 1
                 return {
                    content: [{ type: 'text', text: `Image generated: ${firstJobInArray.result.blobUrl}` }],
                 };
              } else {
                console.error('[Civitai MCP] Job completed but no image URL found in response (wait=true). Response:', JSON.stringify(response));
                throw new McpError(ErrorCode.InternalError, 'Civitai job completed (wait=true) but no image URL was returned.');
              }
            }
          } else {
            // If not waited, response contains token and initial job status
             if (response.token) {
                console.error(`[Civitai MCP] Job submitted. Token: ${response.token}`);
                return {
                  content: [{ type: 'text', text: `Civitai job submitted. Token: ${response.token}. Use civitai.jobs.getByToken to check status.` }],
                };
            } else {
                console.error('[Civitai MCP] Job submission failed or did not return a token (wait=false). Response:', JSON.stringify(response));
                throw new McpError(ErrorCode.InternalError, 'Civitai job submission did not return a token (wait=false).');
            }
          }

        } catch (error: any) {
          console.error('[Civitai MCP] API Error:', error);
          // Try to extract a meaningful error message
          const errorMessage = error?.message || 'Unknown error calling Civitai API';
          const errorDetails = error?.response?.data ? JSON.stringify(error.response.data) : '';
          return {
            content: [{ type: 'text', text: `Civitai API Error: ${errorMessage}${errorDetails ? ` (${errorDetails})` : ''}` }],
            isError: true,
          };
        }
      }
    );
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Civitai Image Generation MCP server running on stdio');
  }
}

// --- Environment Variable Loading ---
const API_KEY = process.env.CIVITAI_API_TOKEN;

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