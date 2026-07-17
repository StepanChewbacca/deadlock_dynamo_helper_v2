#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  createDiagnosticBaselineQueryFromTimeline,
  createRecipeGraph,
  evaluateDiagnosticBaseline,
  parseDiagnosticArchive,
  summarizeDiagnosticDataset,
  trainDiagnosticBaseline,
} = require('../dist');

function main(argv) {
  const options = parseArguments(argv);
  if (!options.archivePaths.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const recipes = options.recipesPath ? readJson(options.recipesPath) : [];
  if (!Array.isArray(recipes)) throw new Error('Recipe file must contain an array.');
  const recipeGraph = createRecipeGraph(recipes);
  const archives = options.archivePaths.map((archivePath) => ({
    archivePath,
    result: parseDiagnosticArchive(new Uint8Array(fs.readFileSync(archivePath)), { recipeGraph }),
  }));
  const matches = archives.flatMap(({ result }) => result.matches);
  const model = trainDiagnosticBaseline(matches);
  const evaluation = evaluateDiagnosticBaseline(matches, { minSupport: options.minSupport });

  const latestLocalRecommendations = [];
  for (const match of matches) {
    if (!match.localPlayerKey) continue;
    const query = createDiagnosticBaselineQueryFromTimeline(match, match.localPlayerKey, options.limit);
    if (!query) continue;
    latestLocalRecommendations.push({
      matchId: match.matchId,
      playerKey: match.localPlayerKey,
      query,
      recommendations: model.recommend({ ...query, minSupport: options.minSupport }),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    archives: archives.map(({ archivePath, result }) => ({
      archivePath: path.resolve(archivePath),
      sessionInfo: result.sessionInfo,
      matchIds: result.matches.map((match) => match.matchId),
      markerResults: result.markerResults,
      diagnostics: result.diagnostics,
    })),
    dataset: summarizeDiagnosticDataset(matches),
    model: model.getSummary(),
    evaluation,
    latestLocalRecommendations,
  };

  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    fs.writeFileSync(options.outputPath, output, 'utf8');
    process.stdout.write(`Wrote ${options.outputPath}\n`);
  } else {
    process.stdout.write(output);
  }
}

function parseArguments(argv) {
  const result = { archivePaths: [], limit: 5, minSupport: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--recipes') result.recipesPath = requireValue(argv, ++index, argument);
    else if (argument === '--output') result.outputPath = requireValue(argv, ++index, argument);
    else if (argument === '--limit') result.limit = positiveInteger(requireValue(argv, ++index, argument), argument);
    else if (argument === '--min-support') result.minSupport = positiveInteger(requireValue(argv, ++index, argument), argument);
    else if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else result.archivePaths.push(argument);
  }
  return result;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  diagnostic-baseline <archive.zip> [more.zip ...] [options]',
    '',
    'Options:',
    '  --recipes <recipes.json>   Recipe definitions for upgrade inference',
    '  --output <report.json>     Write the report to a file',
    '  --limit <number>           Recommendations per query (default: 5)',
    '  --min-support <number>     Minimum bucket support (default: 1)',
    '',
  ].join('\n'));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
