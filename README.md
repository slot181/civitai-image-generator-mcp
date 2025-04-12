# Civitai Image Generator MCP Server

This is a Model Context Protocol (MCP) server that provides a tool to generate images using the Civitai API. It submits the generation request and then polls the Civitai API until the image is ready, returning the final image URL.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- A Civitai API Token

## Setup

1.  **Clone the repository (or ensure you have the files):**
    ```bash
    # If you cloned a repo, navigate into it
    # cd civitai-image-generator-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set the Civitai API Token:**
    The server needs your Civitai API token. You can provide it in two ways (the server prioritizes the first method if both are present):
    *   **Command-line argument (`-e`):** When starting the server via a proxy or directly, pass the token using `-e`:
        ```bash
        # Example with mcp-proxy
        mcp-proxy -- node dist/index.js -e CIVITAI_API_TOKEN "your_api_token_here"

        # Example direct execution (less common for MCP)
        node dist/index.js -e CIVITAI_API_TOKEN "your_api_token_here"
        ```
    *   **Environment variable:** Export the variable in your shell before starting the server:
        ```bash
        export CIVITAI_API_TOKEN="your_api_token_here"
        node dist/index.js
        ```
        (Creating a `.env` file is **not** directly supported by this server; use the methods above.)

## Running the Server

1.  **Build the TypeScript code:**
    ```bash
    npm run build
    ```

2.  **Start the server (listening on stdio):**
    ```bash
    # Using environment variable
    export CIVITAI_API_TOKEN="your_api_token_here"
    npm start

    # Or using command-line argument
    npm start -- -e CIVITAI_API_TOKEN "your_api_token_here"
    ```
    For development with auto-rebuild and restart on changes:
    ```bash
    # Using environment variable
    export CIVITAI_API_TOKEN="your_api_token_here"
    npm run dev

    # Or using command-line argument
    npm run dev -- -e CIVITAI_API_TOKEN "your_api_token_here"
    ```

## MCP Client Configuration (Example for VS Code)

To use this server with an MCP client like the VS Code extension, add a configuration similar to this to your client's settings (e.g., `.vscode/settings.json`):

```json
{
  "mcp.servers": {
    // Choose a name for this server connection
    "civitai-image-gen": {
      // Option 1: Run the installed package using npx (if published)
      // "command": "npx",
      // "args": ["civitai-image-generator-mcp@latest", "-y", "-e", "CIVITAI_API_TOKEN", "${env:CIVITAI_API_TOKEN}"], // Assumes token is in env var

      // Option 2: Run the compiled code directly from your local clone
      "command": "node",
      "args": [
        // Adjust the path to where you cloned the repo and built it
        "/path/to/your/civitai-image-generator-mcp/dist/index.js",
        "-e", // Pass token via command line argument
        "CIVITAI_API_TOKEN",
        // Replace with your actual token or use an environment variable reference
        // like "${env:CIVITAI_API_TOKEN}" if your client supports it
        "your_api_token_here"
      ],
      // Alternatively, set the environment variable directly (less secure if checked into source control)
      // "env": {
      //   "CIVITAI_API_TOKEN": "your_api_token_here"
      // }
    }
  }
}
```

**Notes on Configuration:**

*   Replace `/path/to/your/civitai-image-generator-mcp/dist/index.js` with the actual path to the compiled server file on your system.
*   Replace `"your_api_token_here"` with your actual Civitai API token. Using environment variable references like `${env:CIVITAI_API_TOKEN}` is generally safer if supported by your client.
*   The `-e CIVITAI_API_TOKEN "..."` arguments are used to pass the API token directly via the command line, which the server now supports.

## Usage

Once connected to an MCP client, the server provides the following tool:

-   **`generate_image`**: Submits an image generation job to the Civitai API, polls for completion, and returns the image URL.

    **Input Parameters:**
    -   `prompt` (string, required): Text prompt for image generation.
    -   `model` (string, required): The Civitai model URN (e.g., `urn:air:sd1:checkpoint:civitai:4201@130072`).
    -   `negativePrompt` (string, optional): Negative prompt.
    -   `scheduler` (enum, optional, default: `EulerA`): Scheduler algorithm (e.g., `EulerA`, `DPM2`, `LCM`).
    -   `steps` (number, optional, default: 20): Inference steps (1-100).
    -   `cfgScale` (number, optional, default: 7): CFG scale (1-30).
    -   `width` (number, optional, default: 512): Image width (64-1024, multiple of 8).
    -   `height` (number, optional, default: 768): Image height (64-1024, multiple of 8).
    -   `seed` (number, optional): Seed (-1 for random).
    -   `clipSkip` (number, optional, default: 2): CLIP skips (1-10).
    -   `additionalNetworks` (object, optional): Additional networks (LoRA, etc.) keyed by URN (e.g., `{ "urn:air:sd1:lora:...": { "strength": 0.8 } }`).
    *   (`wait` parameter is removed - the server now always waits/polls)*

    **Output:**
    -   On success: Text containing the URL of the generated image (e.g., `Image generated: https://...`).
    -   On error: An error message detailing the failure (e.g., API error, polling timeout, result extraction error).

    **Polling Behavior:**
    - The server submits the job and then checks the status every 2 seconds.
    - It will time out after 5 minutes if the job doesn't complete.