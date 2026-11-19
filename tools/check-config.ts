import { describeRuntimeConfig, readRuntimeConfig } from '../config/runtime';

try {
  console.log(JSON.stringify(describeRuntimeConfig(readRuntimeConfig())));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration');
  process.exitCode = 1;
}
