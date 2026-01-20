
# Terraform WebGPU Globe

This project is a procedural planet renderer and terrain generator using TypeScript and WebGPU. It generates a 3D globe with realistic elevation, ocean/land distribution, and interactive controls.



## Features
- Procedural icosphere mesh generation
- Elevation and landmass based on fractal noise (SimplexNoise3D)
- Adjustable ocean surface area (via slider)
- Realistic elevation distribution (split-normal, percentile-based)
- WebGPU rendering with per-vertex normals and lighting
- Interactive camera (mouse wheel zoom)
- Real-time mesh/statistics updates

## Getting Started

1. Install dependencies:
   ```sh
   npm install
   ```
2. Build the project:
   ```sh
   npm run build
   ```

3. Start the development server:
   ```sh
   npm run dev
   ```
   This will launch a local web server and print a local address (such as http://localhost:5173) in the terminal. Open that link in your browser.
   
   Do not open `index.html` directly/locally, as this will cause CORS errors in most browsers.
   Make sure it is served to a webserver to run it, like on localhost or on github.io, etc.
   
   Make sure you use a browser that supports WebGPU (such as a recent version of Chrome or Edge).

## Controls
- **Ocean Surface Area Slider:** Adjusts the percentage of the globe covered by ocean. The mesh and statistics update in real time.
- **Mouse Wheel:** Zooms the camera in and out.


## Project Structure
- `src/` - Source TypeScript files
- `dist/` - Compiled JavaScript output
- `tsconfig.json` - TypeScript configuration
- `package.json` - NPM scripts and dependencies


## Notes
- Requires a GPU and browser with WebGPU support.
- All terrain and landmass are generated procedurally on each load.
- See code comments for details on mesh generation, noise, and rendering pipeline.
