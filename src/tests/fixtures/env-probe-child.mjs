// ⚠ TEST FIXTURE — stands in for the inspection child and reports how many environment
// variables it can see (the inspector must start it with none), as an InspectionResult.
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(`${JSON.stringify({ pdfSecurity: { result: "pass" }, activeContent: { result: "pass", findings: [] }, pages: Object.keys(process.env).length })}\n`);
});
