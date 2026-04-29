#!/usr/bin/env zx

import type { Dirent } from 'fs';
import 'zx/globals';

interface RawMusicPart {
  name: string
  offset?: number
}

interface MusicPart {
  name: string
  src: string
  offset?: number
  duration: number
}

interface RawMusicMetadata {
  id: string
  title: string
  uploadTime?: string
  time?: {
    loopStart?: number
    loopEnd?: number
  }
  parts?: RawMusicPart[]
  tags?: string[]
};

interface MusicMetadata {
  id: string
  version?: number
  title: string
  src: string
  uploadTime: string
  updateTime: string
  time: {
    duration: number
    loopStart?: number
    loopEnd?: number
  }
  parts?: MusicPart[]
  tags?: string[]
};

interface FileMetadata {
  fileName: string
  base: string
  id: string
  version: number
  partName: string
  ext: string
}

interface AutoMetadata {
    version: number
    main?: FileMetadata
    parts: Map<string, FileMetadata>
}

const dryRunFlag = argv.dry;
const cleanupFlag = argv.cleanup;

if (dryRunFlag) {
  console.log(
    chalk.black.bgYellow('(!)'),
    chalk.yellow('DRY RUN - No changes written on disk\n'),
  );
}

const RAW_DIR = 'raw';
const DATA_DIR = 'data';
const OUTPUT_DIR = dryRunFlag ? tmpdir('data') : DATA_DIR;
const RAW_DISCO_FILE = path.join(RAW_DIR, 'discography.json');
const CURRENT_DISCO_FILE = path.join(DATA_DIR, 'discography.json');

await fs.mkdir(DATA_DIR, { recursive: true });

const tryReadJson = async <T = any>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

const currentDiscography = await tryReadJson<MusicMetadata[]>(CURRENT_DISCO_FILE, []);
const rawDiscography = await tryReadJson<RawMusicMetadata[]>(RAW_DISCO_FILE, []);

const currentMetadataMap = new Map<string, MusicMetadata>(currentDiscography.map((item) => [item.id, item]));
const rawMetadataMap = new Map<string, RawMusicMetadata>(rawDiscography.map((item) => [item.id, item]));
const autoMetadataMap = new Map();


const now = () => {
  return new Date().toISOString().slice(0, 10);
}

const stringify = (json: any) => {
  if (!json) return '';
  return JSON.stringify(json, null, 2) + '\n';
}

const printDiff = async (string1: any, string2: any, noDiffMessage = '') => {
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

const isAudioFile = (file: Dirent<string>) => {
  return file.isFile() && !file.name.endsWith('.json');
}

const ffprobeDuration = async (filePath: string) => {
  const { stdout } = await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${filePath}`;
  return Number(stdout.trim());
}

const convertToOpus = async (inputPath: string, outputPath: string) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  console.log(`Converting ${inputPath}`, 'to opus format');
  await $`ffmpeg -y -loglevel error -stats -i ${inputPath} -map_metadata -1 -c:a libopus -b:a 160k ${outputPath}`;
}

const parseRawFileMetadata = (fileName: string): FileMetadata => {
  const regex = /^(?<base>(?<id>[^_.]*)(?:_(?<version>\d*))?(?:_(?<partName>[^_.]*))?)\.(?<ext>.*?)$/;
  const { base, id, version, partName, ext } = fileName.match(regex)?.groups ?? {};
  return {
    fileName,
    base,
    id,
    version: Number(version ?? 0),
    partName,
    ext
  };
}

const updateAutoMetadata = (rawFileMetadata: FileMetadata) => {
  const autoMetadata: AutoMetadata = autoMetadataMap.get(rawFileMetadata.id) ?? {
    version: -1,
    main: undefined,
    parts: new Map(),
  };

  if (rawFileMetadata.version < autoMetadata.version) return;

  if (rawFileMetadata.version > autoMetadata.version) {
    autoMetadata.version = rawFileMetadata.version;
    autoMetadata.main = undefined;
    autoMetadata.parts = new Map();
  }

  if (rawFileMetadata.partName) {
    autoMetadata.parts.set(rawFileMetadata.partName, rawFileMetadata);
  }
  else{
    autoMetadata.main = rawFileMetadata;
  }
  autoMetadataMap.set(rawFileMetadata.id, autoMetadata);
}

const sortAutoMetadata = (autoMetadataMap: Map<string, AutoMetadata>) => {
  const sortedAutoMetadata = [];

  // 1) existing tracks keep current order
  for (const item of currentDiscography) {
    const autoMetadata = autoMetadataMap.get(item.id);
    if (autoMetadata) sortedAutoMetadata.push(autoMetadata);
  }

  // 2) new tracks follow raw discography order
  for (const item of rawDiscography) {
    if (currentMetadataMap.has(item.id)) continue;
    const autoMetadata = autoMetadataMap.get(item.id);
    if (autoMetadata) sortedAutoMetadata.push(autoMetadata);
  }

  // 3) orphan tracks (not listed in raw) go last
  for (const [id, group] of autoMetadataMap) {
    if (currentMetadataMap.has(id)) continue;
    if (rawMetadataMap.has(id)) continue;
    sortedAutoMetadata.push(group);
  }

  return sortedAutoMetadata;
}

const sortAutoPartMetadata = (rawMetadata: RawMusicMetadata | undefined, autoMetadata: AutoMetadata) => {
    const sortedParts = [];

    for (const rawPart of rawMetadata?.parts ?? []) {
      const partAuto = autoMetadata.parts.get(rawPart.name);
      if (!partAuto) continue;
      sortedParts.push({ rawPart, partAuto });
    }

    for (const [name, partAuto] of autoMetadata.parts) {
      if (rawMetadata?.parts?.some(p => p.name === name)) continue;
      sortedParts.push({ rawPart: {} as RawMusicPart, partAuto });
    }
    return sortedParts;
}

const processMusicParts = async (rawMetadata: RawMusicMetadata | undefined, autoMetadata: AutoMetadata): Promise<MusicPart[]> => {
  if (!autoMetadata.main) return [];
  if (autoMetadata.parts.size === 0) return [];

  let resolvedParts = [] as MusicPart[];

  const sortedParts = sortAutoPartMetadata(rawMetadata, autoMetadata);

  for (const { rawPart, partAuto } of sortedParts) {
    console.log(
      chalk.magenta('\n', '   >>> '),
      chalk.black.bgCyan(partAuto.fileName, '\n'),
    );

    const partInput = path.join(RAW_DIR, partAuto.fileName);
    const partOutput = path.join(OUTPUT_DIR, autoMetadata.main.id, `${partAuto.base}.opus`);

    await convertToOpus(partInput, partOutput);
    const partDuration = await ffprobeDuration(partOutput);

    const resolvedPart = {} as MusicPart;
    resolvedPart.src = `/data/${autoMetadata.main.id}/${partAuto.base}.opus`;
    if (rawPart.offset) resolvedPart.offset = rawPart.offset;
    resolvedPart.duration = partDuration;
    resolvedParts.push(resolvedPart);
  }

  return resolvedParts;
}

// ---

const rawFiles = await fs.readdir(RAW_DIR, { withFileTypes: true });
const rawAudioFiles = rawFiles.filter(isAudioFile);

for (const rawFile of rawAudioFiles) {
  const rawFileMetadata = parseRawFileMetadata(rawFile.name);
  updateAutoMetadata(rawFileMetadata);
}

const sortedAutoMetadata = sortAutoMetadata(autoMetadataMap);
for (const autoMetadata of sortedAutoMetadata) {
  if (!autoMetadata.main) continue;

  console.log(
    chalk.magenta('\n', '>> '),
    chalk.black.bgCyan(autoMetadata.main.fileName, '\n'),
  );

  const rawMetadata = rawMetadataMap.get(autoMetadata.main.id);
  const currentMetadata = currentMetadataMap.get(autoMetadata.main.id);
  const currentVersion = Number(currentMetadata?.version ?? 0);
  if (autoMetadata.main.version < currentVersion) continue;

  const inputPath = path.join(RAW_DIR, autoMetadata.main.fileName);
  const outputPath = path.join(OUTPUT_DIR, autoMetadata.main.id, `${autoMetadata.main.base}.opus`);

  await convertToOpus(inputPath, outputPath);
  const duration = await ffprobeDuration(outputPath);

  let resolvedParts = await processMusicParts(rawMetadata, autoMetadata);

  const id: MusicMetadata['id'] = autoMetadata.main.id;
  const version: MusicMetadata['version'] = Math.max(currentVersion, autoMetadata.main.version);
  const title: MusicMetadata['title'] = rawMetadata?.title ?? currentMetadata?.title ?? autoMetadata.main.id;
  const tags: MusicMetadata['tags'] = rawMetadata?.tags ?? currentMetadata?.tags ?? [];
  const src: MusicMetadata['src'] = `/data/${autoMetadata.main.id}/${autoMetadata.main.base}.opus`;
  const uploadTime: MusicMetadata['uploadTime'] = rawMetadata?.uploadTime ?? currentMetadata?.uploadTime ?? now();
  const updateTime: MusicMetadata['updateTime'] = now();
  const loopStart: MusicMetadata['time']['loopStart'] = rawMetadata?.time?.loopStart ?? currentMetadata?.time?.loopStart ?? 0;
  const loopEnd: MusicMetadata['time']['loopEnd'] = rawMetadata?.time?.loopEnd ?? currentMetadata?.time?.loopEnd ?? duration;

  const merged = {} as MusicMetadata;
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

  currentMetadataMap.set(autoMetadata.main.id, merged);
}

// Write changes to discography
const finalDiscography = Array.from(currentMetadataMap.values());
if (!dryRunFlag) {
  await fs.writeFile(CURRENT_DISCO_FILE, stringify(finalDiscography));
  console.log('\n');
  console.log(chalk.cyan('discography.json updated'));
}

// Cleanup raw files
if (!dryRunFlag && cleanupFlag) {
  console.log('\n');
  console.log(chalk.red.underline('Cleaning raw files'));

  for (const rawFile of rawAudioFiles) {
    const rawFilePath = path.join(rawFile.parentPath, rawFile.name);
    console.log(chalk.gray('-', rawFilePath));
    fs.remove(rawFilePath);
  }
}
