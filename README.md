# Civitai Image Generator MCP Server

This is a Model Context Protocol (MCP) server that provides a tool to generate images using the Civitai API. It submits the generation request, polls the Civitai API until the image is ready, downloads the generated image, and saves it to a local directory, returning the local file path.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- A Civitai API Token (set via `CIVITAI_API_TOKEN` environment variable or `-e` flag)
- A Civitai Model ID (set via `CIVITAI_MODEL_ID` environment variable or `-e` flag)
- (Optional) A desired output directory (set via `CIVITAI_OUTPUT_DIR` environment variable or `-e` flag, defaults to `./civitai_output`)

## Setup

1.  **Clone the repository (or ensure you have the files):**
    ```bash
    # If you cloned a repo, navigate into it
    # cd civitai-image-generator-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install

3.  **Build the server:**
    ```bash
    npm run build

## MCP Client Configuration

```json
{
  "mcp.servers": {
    // Choose a name for this server connection
    "civitai-image-gen": {
      "command": "node",
      "args": [
        // Adjust the path to where you cloned the repo and built it
        "/path/to/your/civitai-image-generator-mcp/dist/index.js"
      ],
      "env": {
        "CIVITAI_API_TOKEN": "your_api_token_here", // Required
        "CIVITAI_MODEL_ID": "your_model_id_here",   // Required
        "CIVITAI_OUTPUT_DIR": "/path/to/save/images" // Optional, defaults to ./civitai_output relative to where the server runs
      }
    }
  }
}
```

**Notes on Configuration:**

*   Replace `/path/to/your/civitai-image-generator-mcp/dist/index.js` with the actual path to the compiled server file (`index.js` after running `npm run build`) on your system.
*   Replace `"your_api_token_here"` and `"your_model_id_here"` with your actual Civitai API token and desired Model ID.
*   Set `CIVITAI_OUTPUT_DIR` to your preferred image saving location. If omitted, images will be saved in a `civitai_output` directory created where the server is run.
*   You can also pass these environment variables using the `-e KEY VALUE` command-line arguments when running the server directly (e.g., `node dist/index.js -e CIVITAI_API_TOKEN "..." -e CIVITAI_MODEL_ID "..."`). Command-line arguments override environment variables set in the client configuration.

## Usage

Once connected to an MCP client, the server provides the following tool:

-   **`generate_image`**: Submits an image generation job to the Civitai API using the configured Model ID, polls for completion, downloads the result, saves it locally, and returns the local file path.

    **Input Parameters:**
    -   `prompt` (string, required): Text prompt for image generation.
    -   `negativePrompt` (string, optional): Negative prompt.
    -   `scheduler` (enum, optional, default: `EulerA`): Scheduler algorithm (e.g., `EulerA`, `DPM2`, `LCM`).
    -   `steps` (number, optional, default: 20): Inference steps (1-100).
    -   `cfgScale` (number, optional, default: 7): CFG scale (1-30).
    -   `width` (number, optional, default: 512): Image width (64-1024, multiple of 8).
    -   `height` (number, optional, default: 768): Image height (64-1024, multiple of 8).
    -   `seed` (number, optional): Seed (-1 for random).
    -   `clipSkip` (number, optional, default: 2): CLIP skips (1-10).
    -   `additionalNetworks` (object, optional): Additional networks (LoRA, etc.) keyed by URN (e.g., `{ "urn:air:sd1:lora:...": { "strength": 0.8 } }`).

    **Output:**
    -   On success: A JSON string containing the local path to the saved image (e.g., `{"path": "./civitai_output/civitai_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.png"}`).
    -   On error: An error message detailing the failure (e.g., API error, polling timeout, download/save error).

    **Polling Behavior:**
    - The server submits the job and then checks the status every 2 seconds.
    - It will time out after 2 minutes if the job doesn't complete.