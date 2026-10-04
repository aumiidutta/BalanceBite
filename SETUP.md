To setup BalanceBite, follow the mentioned steps and make sure your system meets the prerequisites.

## Prerequisites
| What is needed | Why it is needed |
|---|---|
| Windows 10/11 64-bit | build + run target |
| Node.js 20 LTS or newer | runs the build tools |
| An open-weight GGUF model file | the open weight model |
| 8 GB RAM minimum (16 GB nicer) | model runs in memory |
| ~6 GB free disk | node_modules + model + build |


## Choosing the model
| Model | File size | Notes |
|---|---|---|
| Gemma 3 4B instruct (Q4_K_M) | ~2.5 GB | **Recommended.** Good quality, runs on CPU |
| Gemma 3 1B instruct (Q4_K_M) | ~0.8 GB | Fast, weaker advice, fits a normal installer |
| Llama 3.2 3B instruct (Q4_K_M) | ~2 GB | Good alternative |


## Setup
### Node LTS
- Go to the official [Node.js website](https://nodejs.org/)
- Download the latest **LTS** version for Windows.
- Open the downloaded `.msi` installer.
- Accept the license agreement.
- Keep the default installation location.
- Verify the installation
```bash
node --version
npm --version
```

### Download the model
For my application, I chose "Gemma 3 4B Instruct Q4_K_M GGUF model"
- Visit [Hugging Face model page](https://huggingface.co/jc-builds/Gemma-3-4B-Q4_K_M-GGUF)
- Open "Files and versions"
- Find the model file whose name ends with:
```text
.Q4_K_M.gguf
```
- Click **Download** (The file is approximately *2.5 GB*)
- Move the model to **models** folder and rename it to **model.gguf**
- Verify the model file
```bash
dir models
```

### Run the commands
- Install the dependencies
```bash
npm install
```
Note: This reads `package.json` and installs the project's direct dependencies and their required transitive dependencies.
It creates **node_modules/** and uses **package-lock.json** to record the dependency versions. Warnings about deprecated packages or vulnerabilities do not necessarily mean the installation failed. If npm reports an actual `ERR!` or the installation stops, investigate that error before continuing.

- Update electron 
```bash
npm install electron@latest --save-dev
```
- Update electron builder
```bash
npm install electron-builder@latest --save-dev
```
- Start the application
```bash
npm start
```
- Check for known vulnerabilities
```bash
npm audit
```
- Build the .exe
```bash
npm run dist
```
Note: To share it, **zip the entire win-unpacked folder**. Sending only the *.exe* won't work.


## Quick checklist
Before starting the application, verify:
```text
- Node.js is installed
- npm is installed
- The project folder is available
- The models folder exists
- models/model.gguf exists
- npm install completed successfully
- npm start launches the application
```