import type { ScanReport } from "./types.ts";

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const color = {
  bold: (text: string) => paint("1", text),
  dim: (text: string) => paint("2", text),
  green: (text: string) => paint("32", text),
  yellow: (text: string) => paint("33", text),
  red: (text: string) => paint("31", text),
  cyan: (text: string) => paint("36", text),
};

/** Human-readable report; the JSON shape lives in `ScanReport`. */
export function renderHuman(report: ScanReport): string {
  const lines: string[] = [];
  const { stats } = report;

  lines.push(color.bold(`jevdedup`) + color.dim(` ${report.root}`));
  lines.push(
    `${stats.filesScanned} files (${formatBytes(stats.bytesScanned)}), ` +
      `${stats.sizeCandidates} size candidates`,
  );

  if (stats.duplicateGroups === 0) {
    lines.push(color.green("no exact duplicates found"));
  } else {
    lines.push(
      color.yellow(
        `${stats.duplicateGroups} exact duplicate groups, ` +
          `${formatBytes(stats.wastedBytes)} reclaimable`,
      ),
    );
  }
  lines.push("");

  report.groups.forEach((group, index) => {
    const head =
      color.bold(`[${index + 1}]`) +
      ` ${group.files.length} copies of ${formatBytes(group.size)} ` +
      color.dim(`sha256 ${group.hash.slice(0, 12)}`);
    lines.push(head);

    const verdict = group.verdict;
    for (const file of group.files) {
      const isKeep = verdict !== undefined && file.relativePath === verdict.keep;
      const marker = isKeep ? color.green("keep") : "    ";
      lines.push(`    ${marker}  ${file.relativePath}`);
    }

    if (verdict !== undefined) {
      if (verdict.error !== undefined) {
        lines.push(`    ${color.red(`jev error: ${verdict.error}`)}`);
      } else {
        const safe = verdict.safeToDeleteAllButOne >= 0.5;
        lines.push(
          `    ${color.cyan("jev")}  verdict=${verdict.verdict} ` +
            `keep-is-lossless=${safe ? color.green("yes") : color.yellow("no")} ` +
            color.dim(`(${(verdict.safeToDeleteAllButOne * 100).toFixed(0)}%, model ${verdict.model})`),
        );
      }
    } else if (report.jev.enabled) {
      lines.push(`    ${color.dim("jev  not reviewed (call budget reached)")}`);
    }
    lines.push("");
  });

  if (report.pairs.length > 0) {
    lines.push(
      color.bold("possible semantic duplicates") +
        color.dim(" (same content, different bytes)"),
    );
    for (const pair of report.pairs) {
      const reason = color.dim(`[${pair.reason}]`);
      const verdict = pair.verdict;
      const suffix =
        verdict === undefined
          ? color.dim(" jev: not reviewed")
          : verdict.error !== undefined
            ? color.red(` jev error: ${verdict.error}`)
            : ` ${color.cyan("jev")} ${verdict.relation} p=${verdict.sameContent.toFixed(2)}`;
      lines.push(`  ${pair.a.relativePath} ~ ${pair.b.relativePath} ${reason}${suffix}`);
    }
    lines.push("");
  }

  const jevStatus = report.jev.enabled
    ? `${report.jev.calls} calls` + (report.jev.truncated ? color.yellow(" (truncated by call budget)") : "")
    : color.yellow(`disabled${report.jev.disabledReason ? `: ${report.jev.disabledReason}` : ""}`);
  lines.push(color.dim(`jev: ${jevStatus}`));

  return lines.join("\n");
}

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}
