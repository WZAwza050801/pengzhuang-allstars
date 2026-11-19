#!/usr/bin/env node
// 仅使用 Node 标准库。此检查器验证文档结构，不能代替实际功能验收。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_LINE = /^- \[([ xX])\] \*\*([A-Z]{2,4}-\d{2}[a-z]?)\*\* (.+)$/gm;
const TASK_ID = /\b[A-Z]{2,4}-\d{2}[a-z]?\b/g;

export function inspectTaskDocument(source, log) {
  const errors = [];
  const matches = [...source.matchAll(TASK_LINE)];
  const tasks = new Map();
  if (!matches.length) errors.push('没有识别到任务复选框');
  for (const line of source.split('\n')) {
    if (
      /^- \[[^\]]*\] \*\*[A-Z]{2,4}-\d/.test(line) &&
      !/^- \[([ xX])\] \*\*([A-Z]{2,4}-\d{2}[a-z]?)\*\* .+$/.test(line)
    ) {
      errors.push(`任务格式错误：${line}`);
    }
  }
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const id = match[2];
    const block = source.slice(match.index, matches[i + 1]?.index ?? source.length);
    if (tasks.has(id)) errors.push(`重复编号 ${id}`);
    const metadata = {};
    for (const field of ['依赖', '实施', '产物', '验收', '验证']) {
      const line = block.split('\n').find((line) => line.startsWith(`  - ${field}：`));
      const value = line?.slice(`  - ${field}：`.length).trim();
      if (!value) errors.push(`${id} 缺少 ${field}`);
      metadata[field] = value ?? '';
    }
    const dependencies = metadata['依赖'] === '无' ? [] : [...metadata['依赖'].matchAll(TASK_ID)].map((v) => v[0]);
    if (metadata['依赖'] !== '无' && !dependencies.length) errors.push(`${id} 依赖格式错误`);
    if (new Set(dependencies).size !== dependencies.length) errors.push(`${id} 依赖重复`);
    tasks.set(id, { id, title: match[3], done: match[1].toLowerCase() === 'x', dependencies });
  }
  for (const task of tasks.values()) {
    for (const dep of task.dependencies) {
      if (!tasks.has(dep)) errors.push(`${task.id} 依赖不存在的任务 ${dep}`);
      if (dep === task.id) errors.push(`${task.id} 不能依赖自身`);
      if (task.done && !tasks.get(dep)?.done) errors.push(`${task.id} 已勾选但依赖 ${dep} 未完成`);
    }
    if (task.done) {
      const heading = new RegExp(`^### ${task.id}\\s*$`, 'm');
      const match = heading.exec(log);
      const rest = match ? log.slice(match.index + match[0].length) : '';
      const block = rest.split(/^### /m)[0];
      if (!match || !/^- 状态：完成\s*$/m.test(block)) errors.push(`${task.id} 缺少完成记录`);
      if (!/^- 验证：\S.+/m.test(block)) errors.push(`${task.id} 缺少实际验证记录`);
      if (!/^- 证据：\S.+/m.test(block)) errors.push(`${task.id} 缺少可复查证据`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, chain) {
    if (visiting.has(id)) {
      errors.push(`依赖成环：${[...chain, id].join(' -> ')}`);
      return;
    }
    if (visited.has(id) || !tasks.has(id)) return;
    visiting.add(id);
    for (const dep of tasks.get(id).dependencies) visit(dep, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id, []);
  const all = [...tasks.values()];
  return {
    errors,
    total: all.length,
    done: all.filter((t) => t.done).length,
    groups: [...new Set(all.map((t) => t.id.split('-')[0]))],
    ready: all.filter((t) => !t.done && t.dependencies.every((id) => tasks.get(id)?.done)).map((t) => t.id),
  };
}

function checkLinks(root, files) {
  const errors = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0]);
      const resolved = path.resolve(path.dirname(file), relative);
      if (!resolved.startsWith(root + path.sep)) errors.push(`链接越出仓库：${file}: ${target}`);
      else if (!fs.existsSync(resolved)) errors.push(`链接不存在：${path.relative(root, file)}: ${target}`);
    }
  }
  return errors;
}

export function inspectPlan(root) {
  const dir = path.join(root, 'docs/productization');
  const result = inspectTaskDocument(
    fs.readFileSync(path.join(dir, 'TASKS.md'), 'utf8'),
    fs.readFileSync(path.join(dir, 'EXECUTION_LOG.md'), 'utf8'),
  );
  const files = ['README.md', 'AGENTS.md'].map((f) => path.join(root, f));
  files.push(
    ...fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f)),
  );
  result.errors.push(...checkLinks(root, files));
  result.documents = files.length;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root =
    rootIndex < 0
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      : path.resolve(args[rootIndex + 1]);
  try {
    const result = inspectPlan(root);
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `计划检查：${result.total} 项 / ${result.groups.length} 工作包 / ${result.done} 已完成 / ${result.documents} 文档`,
      );
      console.log(`可领取：${result.ready.join('、') || '暂无，请检查依赖或进行中任务'}`);
      for (const error of result.errors) console.error(`ERROR ${error}`);
      if (!result.errors.length) console.log('PASS 编号、依赖、完成记录与本地链接');
    }
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
