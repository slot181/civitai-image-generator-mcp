# Civitai Image Generator MCP Server

This is a Model Context Protocol (MCP) server that provides a tool to generate images using the Civitai API.

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
    You need to set the `CIVITAI_API_TOKEN` environment variable. You can do this by:
    - Exporting it in your shell:
      ```bash
      export CIVITAI_API_TOKEN="your_api_token_here"
      ```
    - Creating a `.env` file in the project root (this file is ignored by git):
      ```
      CIVITAI_API_TOKEN=your_api_token_here
      ```
      (Note: The current code directly reads `process.env.CIVITAI_API_TOKEN`. For `.env` file support, you would need to add a library like `dotenv`).

## Running the Server

1.  **Build the TypeScript code:**
    ```bash
    npm run build
    ```

2.  **Start the server:**
    ```bash
    npm start
    ```
    Alternatively, for development with auto-rebuild and restart on changes:
    ```bash
    npm run dev
    ```

The server will start and listen on stdio, ready to be connected by an MCP client (like VS Code with the MCP extension).

## Usage

Once connected to an MCP client, the server provides the following tool:

-   **`generate_image`**: Generates an image based on the provided parameters using the Civitai API.

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
    -   `wait` (boolean, optional, default: true): If true, waits for the job to complete and returns the image URL. If false, returns a job token immediately.

    **Output:**
    -   If `wait` is true: Text containing the URL of the generated image.
    -   If `wait` is false: Text containing the job token to check status later.
    -   On error: An error message.