✅ **SOVEREIGN TECH SPEC (v1.0.1)**

**Title:** UI + File Pipeline Detection Engine Implementation
**Layers:** PR Controller, Context Fetcher, Synthesis Engine
**Logic:**
const filePipelineCheck = async (filePath) => {
  try {
    const fileContent = await fs.readFileSync(filePath, 'utf8');
    if (!fileContent.includes('<!-- UI Probe -->')) {
      throw new Error(`File ${filePath} does not contain UI probe marker`);
    }
    const uiProbeRegex = /<!-- UI Probe (.*) -->/;
    const uiProbeMatch = fileContent.match(uiProbeRegex);
    if (!uiProbeMatch) {
      throw new Error(`File ${filePath} does not contain valid UI probe marker`);
    }
    const uiProbeData = uiProbeMatch[1].trim();
    if (/(EPUB|unsupported MIME)/.test(uiProbeData)) {
      throw new Error(`File ${filePath} contains EPUB or unsupported MIME, which may not render correctly`);
    }
  } catch (error) {
    console.error(error.stack);
    process.exit(1);
  }
};

module.exports = filePipelineCheck;