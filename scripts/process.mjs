#!/usr/bin/env node

const RAW_DIR = 'raw';
const DATA_DIR = 'data';
const RAW_DISCO_FILE = path.join(RAW_DIR, 'discography.json');
const CURRENT_DISCO_FILE = path.join(DATA_DIR, 'discography.json')

function stringify (json) {
  if (!json) return '';
  return JSON.stringify(json, null, 2) + '\n';
}

async function printDiff (string1, string2, noDiffMessage = '') {
  const tmp1 = tmpfile('tmp1.json', stringify(string1));
  const tmp2 = tmpfile('tmp2.json', stringify(string2));
  const diff = await $`diff --color=always --unified=100 -Z ${tmp1} ${tmp2}`.nothrow();
  if (diff.exitCode === 0) {
    console.log(noDiffMessage);
  }
  else if (diff.stdout) {
    process.stdout.write(diff.stdout.split('\n').slice(3).join('\n'));
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function parseTrackName(fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const match = base.match(/^(.*?)(?:_(\d+))?$/);
  return { base, ext, id: match?.[1] ?? base, version: match?.[2] ? Number(match[2]) : 0 };
}

async function ffprobeDuration(filePath) {
  const { stdout } = await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${filePath}`;
  return Number(stdout.trim());
}

async function convertToOpus(inputPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  console.log(`Converting ${inputPath}`, 'to opus format');
  await $`ffmpeg -y -loglevel error -stats -i ${inputPath} -map_metadata -1 -c:a libopus -b:a 160k ${outputPath}`;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const currentDiscography = await readJsonIfExists(CURRENT_DISCO_FILE, []);
  const rawDiscography = await readJsonIfExists(RAW_DISCO_FILE, []);

  const currentMetadataMap = new Map(currentDiscography.map((item) => [item.id, item]));
  const rawMetadataMap = new Map(rawDiscography.map((item) => [item.id, item]));

  const rawFiles = await fs.readdir(RAW_DIR, { withFileTypes: true });

  const autoMetadataMap = new Map();
  for (const rawFile of rawFiles) {
    if (!rawFile.isFile() || rawFile.name.endsWith('.json')) continue;
    const autoMetadata = await parseTrackName(rawFile.name);
    const currentAutoMetadata = autoMetadataMap.get(autoMetadata.id);
    if (!currentAutoMetadata || autoMetadata.version > currentAutoMetadata.version) {
      autoMetadataMap.set(autoMetadata.id, { fileName: rawFile.name, ...autoMetadata });
    }
  }

  for (const autoMetadata of autoMetadataMap.values()) {
    console.log(
      chalk.magenta('\n', '>> '),
      chalk.black.bgCyan(autoMetadata.fileName, '\n')
    );

    const inputPath = path.join(RAW_DIR, autoMetadata.fileName);
    const outputDir = path.join(DATA_DIR, autoMetadata.id);
    const outputPath = path.join(outputDir, `${autoMetadata.base}.opus`);

    const rawMetadata = rawMetadataMap.get(autoMetadata.id) ?? {};
    const currentMetadata = currentMetadataMap.get(autoMetadata.id);
    const currentVersion = Number(currentMetadata?.version ?? 0);
    if (autoMetadata.version < currentVersion) continue;

    await convertToOpus(inputPath, outputPath);
    const duration = await ffprobeDuration(outputPath);

    const merged = {
      id: autoMetadata.id,
      version: Math.max(currentVersion, autoMetadata.version),
      title: rawMetadata.title ?? currentMetadata?.title ?? autoMetadata.id,
      tags: rawMetadata.tags ?? currentMetadata?.tags ?? [],
      src: `/data/${autoMetadata.id}/${autoMetadata.base}.opus`,
      uploadTime: rawMetadata.uploadTime ?? currentMetadata?.uploadTime ?? new Date().toISOString().slice(0, 10),
      updateTime: new Date().toISOString().slice(0, 10),
      time: {
        duration,
        loopStart: rawMetadata?.time?.loopStart ?? currentMetadata?.time?.loopStart ?? 0,
        loopEnd: rawMetadata?.time?.loopEnd ?? currentMetadata?.time?.loopEnd ?? duration,
      },
      parts: rawMetadata.parts ?? currentMetadata?.parts ?? [],
    };

    if (merged.version === 0) delete merged.version;
    if (merged.tags.length === 0) delete merged.tags;
    if (merged.time.loopStart === 0) delete merged.time.loopStart;
    if (merged.time.loopEnd === duration) delete merged.time.loopEnd;
    if (merged.parts.length === 0) delete merged.parts;

    console.log('\n');
    await printDiff(
      currentMetadata,
      merged,
      chalk.green('No metadata changes'),
    );

    currentMetadataMap.set(autoMetadata.id, merged);
  }

  const finalDiscography = Array.from(currentMetadataMap.values());

  // await fs.writeFile(CURRENT_DISCO_FILE, stringify(finalDiscography));
  console.log('\n', chalk.cyan('discography.json updated'));
}

main();