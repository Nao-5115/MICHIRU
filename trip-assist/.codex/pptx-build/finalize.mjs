import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspaceDir = 'C:/Users/kris5/.codex/visualizations/2026/10/26/01a178cc-df15-75a3-8fe4-73ea3df74231';
const skillDir = 'C:/Users/kris5/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/Presentations';
const runtimePython = 'C:/Users/kris5/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const finalPath = path.join(workspaceDir, 'deliverable/Trip-Assist-system-architecture.pptx');
const candidatePath = path.join(workspaceDir, 'pptx-build-private/draft.pptx');
const stagingDir = path.join(workspaceDir, 'validation');
await fs.mkdir(stagingDir,{recursive:true});
const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir,'container_tools/artifact_tool_utils.mjs')).href);
const result = await finalizePresentation({
  workspaceDir, candidatePath, finalPath, pythonExecutable: runtimePython,
  integrityValidatorPath: path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
  explicitTotalSlideCount:3,
  requiredNativeTableOwnerSlides:[], requiredNativeChartOwnerSlides:[],
  fontPolicy:{basis:'design',families:['Aptos']},
  verifyArtifactToolImport:true,
  receiptPath:path.join(stagingDir,'Trip-Assist-system-architecture.validation.json'),
});
console.log(JSON.stringify(result,null,2));
