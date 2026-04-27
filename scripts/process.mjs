#!/usr/bin/env node

const RAW_DIR = 'raw';
const DATA_DIR = 'data';
const RAW_DISCO_FILE = path.join(RAW_DIR, 'discography.json');
const CURRENT_DISCO_FILE = path.join(DATA_DIR, 'discography.json');

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

async function tryReadJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function parseAutoMetadata(fileName) {
  const regex = /^(?<base>(?<id>[^_.]*)(?:_(?<version>\d*))?(?:_(?<partName>[^_.]*))?)\.(?<ext>.*?)$/;
  const { base, id, version, partName, ext } = fileName.match(regex)?.groups ?? {};
  return {
    base,
    id,
    version: Number(version ?? 0),
    partName,
    ext
  };
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

  const currentDiscography = await tryReadJson(CURRENT_DISCO_FILE, []);
  const rawDiscography = await tryReadJson(RAW_DISCO_FILE, []);

  const currentMetadataMap = new Map(currentDiscography.map((item) => [item.id, item]));
  const rawMetadataMap = new Map(rawDiscography.map((item) => [item.id, item]));

  const rawFiles = await fs.readdir(RAW_DIR, { withFileTypes: true });

  // ===== GROUP FILES BY ID + VERSION =====
  const autoGroupedMetadataMap = new Map();

  for (const rawFile of rawFiles) {
    if (!rawFile.isFile() || rawFile.name.endsWith('.json')) continue;
    const autoMetadata = await parseAutoMetadata(rawFile.name);

    const group = autoGroupedMetadataMap.get(autoMetadata.id) ?? { version: -1, main: null, parts: new Map() };

    if (autoMetadata.version < group.version) continue;

    if (autoMetadata.version > group.version) {
      group.version = autoMetadata.version;
      group.main = null;
      group.parts = new Map();
    }

    if (autoMetadata.partName) {
      group.parts.set(autoMetadata.partName, {
        fileName: rawFile.name,
        ...autoMetadata,
      });
    }
    else{
      group.main = {
        fileName: rawFile.name,
        ...autoMetadata,
      };
    }

    autoGroupedMetadataMap.set(autoMetadata.id, group);
  }

  for (const group of autoGroupedMetadataMap.values()) {
    if (!group.main) continue;
    const autoMainMetadata = group.main;

    console.log(
      chalk.magenta('\n', '>> '),
      chalk.black.bgCyan(autoMainMetadata.fileName, '\n'),
    );

    const inputPath = path.join(RAW_DIR, autoMainMetadata.fileName);
    const outputDir = path.join(DATA_DIR, autoMainMetadata.id);
    const outputPath = path.join(outputDir, `${autoMainMetadata.base}.opus`);

    const rawMetadata = rawMetadataMap.get(autoMainMetadata.id) ?? {};
    const currentMetadata = currentMetadataMap.get(autoMainMetadata.id);
    const currentVersion = Number(currentMetadata?.version ?? 0);
    if (autoMainMetadata.version < currentVersion) continue;

    await convertToOpus(inputPath, outputPath);
    const duration = await ffprobeDuration(outputPath);

    let resolvedParts = [];
    if (rawMetadata.parts?.length > 0) {
      for (const partAuto of group.parts.values()) {
        const rawPart = rawMetadata.parts.find(part => part.name === partAuto.partName);

        console.log(
          chalk.magenta('\n', '   >>> '),
          chalk.black.bgCyan(partAuto.fileName, '\n'),
        );

        const partInput = path.join(RAW_DIR, partAuto.fileName);
        const partOutput = path.join(DATA_DIR, autoMainMetadata.id, `${partAuto.base}.opus`);

        await convertToOpus(partInput, partOutput);
        const partDuration = await ffprobeDuration(partOutput);

        const resolvedPart = {};
        resolvedPart.src = `/data/${autoMainMetadata.id}/${partAuto.base}.opus`;
        if (rawPart.offset) resolvedPart.offset = rawPart.offset;
        resolvedPart.duration = partDuration;
        resolvedParts.push(resolvedPart);
      }
    }

    const id = autoMainMetadata.id;
    const version = Math.max(currentVersion, autoMainMetadata.version);
    const title = rawMetadata.title ?? currentMetadata?.title ?? autoMainMetadata.id;
    const tags = rawMetadata.tags ?? currentMetadata?.tags ?? [];
    const src = `/data/${autoMainMetadata.id}/${autoMainMetadata.base}.opus`;
    const uploadTime = rawMetadata.uploadTime ?? currentMetadata?.uploadTime ?? new Date().toISOString().slice(0, 10);
    const updateTime = new Date().toISOString().slice(0, 10);
    const loopStart = rawMetadata?.time?.loopStart ?? currentMetadata?.time?.loopStart ?? 0;
    const loopEnd = rawMetadata?.time?.loopEnd ?? currentMetadata?.time?.loopEnd ?? duration;

    const merged = {}
    merged.id = id;
    if (version !== 0) merged.version = version;
    merged.title = title;
    if (tags.length !== 0) merged.tags = tags;
    merged.src = src;
    merged.uploadTime = uploadTime;
    merged.updateTime = updateTime;
    merged.time = { duration };
    if (loopStart !== 0) merged.time.loopStart = loopStart;
    if (loopEnd !== duration) merged.time.loopEnd = loopEnd;
    if (resolvedParts.length !== 0) merged.parts = resolvedParts;

    console.log('\n');
    await printDiff(currentMetadata, merged, chalk.green('No metadata changes'));

    currentMetadataMap.set(autoMainMetadata.id, merged);
  }

  const finalDiscography = Array.from(currentMetadataMap.values());
  await fs.writeFile(CURRENT_DISCO_FILE, stringify(finalDiscography));
  console.log('\n', chalk.cyan('discography.json updated'));
}

main();