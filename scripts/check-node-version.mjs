const requiredMajor = 22;
const currentMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

if (currentMajor < requiredMajor) {
  console.warn(
    `WARNING: CareGuard requires Node.js ${requiredMajor} or later. Current runtime is ${process.version}. Run \`nvm use\` or install Node.js ${requiredMajor}+ before installing dependencies.`,
  );
  process.exit(1);
}
