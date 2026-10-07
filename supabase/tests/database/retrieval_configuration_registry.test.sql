-- pgTAP: 8B-I6 — register over retrieval-konfigurationer, evaluation_publisher, godkendelse,
-- aktivering, suspendering og retrieval-konteksten (docs/08b §4.5, §9, §10, §21.9).
-- Alt rulles tilbage.
--
-- Rapporten nedenfor er GENERERET af den rigtige evalueringsmotor (src/tests/fixtures/
-- evaluation-report.ts, buildReport()) — den samme, som TypeScript-testene bruger. En Vitest-test
-- (evaluation-publisher.test.ts) kontrollerer, at literalen her er identisk med den genererede.
-- Testen kører som postgres; "set local role evaluation_publisher_login" kræver, at postgres
-- midlertidigt får SET på login-rollen (kun i transaktionen).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(117);

-- ----------------------------------------------------------------------------
-- Hjælpere (kun i testens transaktion)
-- ----------------------------------------------------------------------------

-- Den genererede rapport og gate-sættet, præcis som TypeScript skrev dem.
create function pg_temp.ts_report() returns jsonb language sql immutable as $f$ select $report${"reportSchema":3,"kind":"retrieval-evaluation","engine":"8B-I6/3","runId":"f6000000-0000-4000-8000-0000000000aa","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":99,"retiredCases":0,"byType":{"direct":75,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":6,"distractor":3,"permission":10,"filter":0},"bySplit":{"dev":99,"holdout":0}},"gateSet":{"id":"gates","version":1,"decision":"B-020","k":8,"checksum":"b573b331ee808054289f7bb44ae5ffe0471a1be68fd266cdc45a3b5d19349149"},"configuration":{"label":"fixture-bedrock","adapter":"fixture-evaluation","environment":"evaluation","declared":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"declaredFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","runtime":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"]},"metrics":{"source_recall_at_k":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"passage_recall_at_k":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"mrr_at_k":{"value":1,"numerator":null,"denominator":83,"interval":null},"correct_abstention":{"value":1,"numerator":16,"denominator":16,"interval":{"lower":0.8063923194655637,"upper":1}},"false_abstention":{"value":0,"numerator":0,"denominator":83,"interval":{"lower":0,"upper":0.04423530964197385}},"distractor_intrusion":{"value":0,"numerator":0,"denominator":36,"interval":{"lower":0,"upper":0.09641862859446367}},"informational":{"source_recall_at_1":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"source_recall_at_3":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"full_coverage_at_k":{"value":1,"numerator":null,"denominator":83,"interval":null},"ndcg_at_k":{"value":1,"numerator":null,"denominator":83,"interval":null}}},"rerankerComparison":{"available":true,"withReranker":{"passage_recall_at_k":1,"mrr_at_k":1},"withoutReranker":{"passage_recall_at_k":1,"mrr_at_k":1}},"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"Q1","metric":"source_recall_at_k","comparator":">=","threshold":0.95,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.950 (83/83), 95 %-interval [0.956; 1.000]."},{"id":"Q2","metric":"passage_recall_at_k","comparator":">=","threshold":0.85,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.850 (83/83), 95 %-interval [0.956; 1.000]."},{"id":"Q3","metric":"mrr_at_k","comparator":">=","threshold":0.7,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.700 (n = 83)."},{"id":"Q4","metric":"correct_abstention","comparator":">=","threshold":0.8,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.800 (16/16), 95 %-interval [0.806; 1.000]."},{"id":"Q5","metric":"false_abstention","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/83), 95 %-interval [0.000; 0.044]."},{"id":"Q6","metric":"distractor_intrusion","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/36), 95 %-interval [0.000; 0.096]."},{"id":"Q7","metric":"reranker_uplift","comparator":"not_lower","threshold":null,"value":0,"status":"pass","uncertain":false,"explanation":"Med reranker: Passage Recall 1.000, MRR 1.000. Uden: 1.000, 1.000."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":75,"met":true},{"label":"ubesvarbare","minimum":5,"actual":6,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":10,"met":true}],"tier":"pilot","verdict":"pass","valid":true,"invalidReasons":[],"failures":[],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-021","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-022","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-023","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-024","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-025","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-026","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-027","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-028","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-029","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-030","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-031","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-032","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-033","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-034","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-035","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-036","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-037","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-038","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-039","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-040","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-041","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-042","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-043","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-044","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-045","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-046","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-047","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-048","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-049","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-050","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-051","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-052","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-053","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-054","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-055","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-056","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-057","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-058","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-059","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-060","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-061","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-062","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-063","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-064","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-065","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-066","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-067","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-068","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-069","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-070","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-071","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-072","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-073","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-074","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-075","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-006","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-004","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-005","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-006","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-007","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-008","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-009","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-010","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"7bdc99f5668922755360d873e4f73d015e31563d7849eb1fd2fefa352c1bbbec","report":"e750a88fab74a9dc60bbca9391250d76da98147c216ddf08c0d337b145e6bd0d"}}$report$::jsonb $f$;
create function pg_temp.ts_gates() returns jsonb language sql immutable as $f$ select $gates${"id":"gates","version":1,"decision":"B-020","description":"De initiale kvalitetsgates Q1–Q7 for 8B (docs/08b §4.4, D-6). Kun tærsklerne er data. Metrik og retning er låst i koden, og de hårde gates H1–H7 er invarianter med nul tolerance, som aldrig står her. Rekalibrering kræver en ny version af filen, en ny versionsstyret baseline og en godkendt beslutning.","k":8,"quality":{"Q1":{"metric":"source_recall_at_k","comparator":">=","threshold":0.95},"Q2":{"metric":"passage_recall_at_k","comparator":">=","threshold":0.85},"Q3":{"metric":"mrr_at_k","comparator":">=","threshold":0.7},"Q4":{"metric":"correct_abstention","comparator":">=","threshold":0.8},"Q5":{"metric":"false_abstention","comparator":"<=","threshold":0.1},"Q6":{"metric":"distractor_intrusion","comparator":"<=","threshold":0.1},"Q7":{"metric":"reranker_uplift","comparator":"not_lower"}}}$gates$::jsonb $f$;

-- En forfalsker med algoritmen: genberegner checksums efter en ændring.
create function pg_temp.reseal(r jsonb) returns jsonb language plpgsql as $f$
declare
  v jsonb := r;
begin
  v := jsonb_set(v, '{checksums,results}', to_jsonb(knowledge.checksum_of(jsonb_build_object(
    'metrics', v -> 'metrics', 'rerankerComparison', v -> 'rerankerComparison', 'hardGates', v -> 'hardGates',
    'qualityGates', v -> 'qualityGates', 'minimums', v -> 'minimums', 'tier', v -> 'tier', 'verdict', v -> 'verdict',
    'valid', v -> 'valid', 'invalidReasons', v -> 'invalidReasons', 'failures', v -> 'failures', 'cases', v -> 'cases'))));
  return jsonb_set(v, '{checksums,report}', to_jsonb(knowledge.checksum_of(
    (v - 'checksums') || jsonb_build_object('checksums', jsonb_build_object('results', v #> '{checksums,results}')))));
end $f$;

create function pg_temp.with_run(r jsonb, p_run text) returns jsonb language sql as $f$
  select pg_temp.reseal(jsonb_set(r, '{runId}', to_jsonb(p_run)))
$f$;

-- Samme rapport for en anden konfiguration (materiale), som en ny kørsel.
create function pg_temp.with_material(r jsonb, m jsonb, p_run text) returns jsonb language sql as $f$
  select pg_temp.reseal(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(r, '{configuration,declared}', m), '{configuration,runtime}', m),
      '{configuration,declaredFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(m))),
      '{configuration,runtimeFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(m))), '{runId}', to_jsonb(p_run)))
$f$;

-- Testens egne identiteter, så registret (der aldrig tømmes) kan indeholde andre rækker:
-- et eget gate-sæt-id, en egen model-version, et eget label og et unikt run-id.
create temp table pgtap_ids as select gen_random_uuid()::text as run;
grant select on pgtap_ids to public;
create function pg_temp.gates() returns jsonb language sql stable as $f$
  select jsonb_set(pg_temp.ts_gates(), '{id}', '"pgtap-gates"')
$f$;
create function pg_temp.base_report() returns jsonb language sql stable as $f$
  select pg_temp.with_material(
    jsonb_set(jsonb_set(pg_temp.ts_report(), '{configuration,label}', '"pgtap-bedrock"'),
      '{gateSet}', (pg_temp.ts_report() -> 'gateSet') || jsonb_build_object('id', 'pgtap-gates', 'checksum', knowledge.checksum_of(pg_temp.gates()))),
    jsonb_set(pg_temp.ts_report() #> '{configuration,declared}', '{embedding,modelVersion}', '"pgtap-1024-v1"'),
    (select run from pgtap_ids))
$f$;

create function pg_temp.material(p_path text[], p_value jsonb) returns jsonb language sql as $f$
  select jsonb_set(pg_temp.base_report() #> '{configuration,declared}', p_path, p_value)
$f$;

-- En regressionskørsel med ét brud på H1 (en ellers bestået rapport).
create function pg_temp.with_h1_breach(r jsonb, p_run text) returns jsonb language sql as $f$
  select pg_temp.with_run(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(r,
      '{cases,0,violations}', '[{"gate":"H1","caseId":"direct-001","explanation":"pgTAP: fiktivt brud"}]'),
      '{failures}', '[{"caseId":"direct-001","gate":"H1","explanation":"pgTAP: fiktivt brud","rootCauseNote":null}]'),
      '{hardGates,0}', '{"id":"H1","status":"fail","violations":1}'),
      '{verdict}', '"fail"'),
    p_run)
$f$;

-- Evalueret som én konfiguration, kørt som en anden (H6 på kørselsniveau), som runner.ts skriver det.
create function pg_temp.with_h6_breach(r jsonb) returns jsonb language sql as $f$
  select pg_temp.reseal(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(r,
      '{configuration,runtime}', jsonb_set(r #> '{configuration,declared}', '{params,topK}', '3')),
      '{configuration,runtimeFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(jsonb_set(r #> '{configuration,declared}', '{params,topK}', '3')))),
      '{configuration,matches}', 'false'),
      '{failures}', '[{"caseId":null,"gate":"H6","explanation":"pgTAP: runtime er ikke den evaluerede","rootCauseNote":null}]'),
      '{hardGates,5}', '{"id":"H6","status":"fail","violations":1}'),
      '{valid}', 'false'),
      '{verdict}', '"fail"'))
$f$;

create function pg_temp.publish(r jsonb) returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local role evaluation_publisher_login;
  v := knowledge.record_evaluation_run(r);
  reset role;
  return v;
end $f$;

create function pg_temp.register_gates(g jsonb) returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local role evaluation_publisher_login;
  v := knowledge.register_evaluation_gate_set(g);
  reset role;
  return v;
end $f$;

create function pg_temp.as_user(p_auth uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
end $f$;

create function pg_temp.cfg(p_label text, p_version int default 1) returns uuid language sql stable as $f$
  select id from knowledge.retrieval_configurations where label = p_label and version = p_version
$f$;

-- 8B-I5: en fixture-version består sikkerhedskontrollen (som postgres, efter tilstandsmaskinen).
create function pg_temp.release(p_version uuid) returns void language plpgsql as $release$
declare v_verdict uuid;
begin
  insert into knowledge.security_verdicts (document_version_id, policy_version, checksum_sha256, byte_size, detected_mime,
    object_bucket, object_path, structural_result, malware_result, scanner_engine, scanner_version, signature_version,
    signature_time, pdf_security_result, active_content_result, final_verdict, released_at)
  select v.id, 'pdf-v1', v.checksum_sha256, coalesce(v.byte_size, 0), 'application/pdf', 'knowledge-originals', v.storage_path,
         'pass', 'clean', 'development-fixture', '0', '0', now(), 'pass', 'pass', 'safe', now()
  from knowledge.document_versions v where v.id = p_version
  returning id into v_verdict;
  update knowledge.document_versions set security_state = 'scanning' where id = p_version;
  update knowledge.document_versions
  set security_state = 'released', storage_bucket = 'knowledge-originals', security_verdict_id = v_verdict, security_released_at = now()
  where id = p_version;
end $release$;

-- ----------------------------------------------------------------------------
-- Fiktive data. Andre versioner og modeller tages ud af betragtning i transaktionen.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('60000000-0000-4000-a000-000000000001', 'r.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Administrator"}'),
  ('60000000-0000-4000-a000-000000000002', 'r.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r
  on r.key = case when u.auth_id = '60000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id in ('60000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000002');

update knowledge.document_versions set status = 'processed' where status = 'under_review';
update knowledge.document_versions set status = 'discarded' where status in ('processed', 'rejected');
update knowledge.document_versions set status = 'withdrawn', withdrawn_at = now(), withdrawal_category = 'other',
  withdrawal_reason = 'pgTAP-isolation' where status = 'published';

-- Bedrock-modellen (kandidat) og et publiceret dokument med chunker-version structure/1.
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('61000000-0000-4000-a000-000000000001', 'aws-bedrock', 'cohere.embed-v4:0', 'pgtap-1024-v1', 1024, 'candidate');
create temp table pgtap_model as select '61000000-0000-4000-a000-000000000001'::uuid as id;
grant select on pgtap_model to public;
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('61000000-0000-4000-a000-000000000002', 'pgtap', 'uden-konfiguration', '1', 3, 'candidate');

insert into knowledge.products (id, name) values ('62000000-0000-4000-a000-000000000001', 'pgTAP Registerprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000001', '62000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Betingelser'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000002', '62000000-0000-4000-a000-000000000001', 'acceptance_rules', id, 'pgTAP Acceptregler'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('64000000-0000-4000-a000-000000000001', '63000000-0000-4000-a000-000000000001', '1', '2020-01-01', 'r/1.pdf', repeat('7', 64)),
       ('64000000-0000-4000-a000-000000000002', '63000000-0000-4000-a000-000000000002', '1', '2020-01-01', 'r/2.pdf', repeat('8', 64));
select pg_temp.release('64000000-0000-4000-a000-000000000001');
select pg_temp.release('64000000-0000-4000-a000-000000000002');
update knowledge.document_versions set status = 'processing' where id in ('64000000-0000-4000-a000-000000000001', '64000000-0000-4000-a000-000000000002');
insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
  char_start, char_end, content_hash, char_count, token_estimate)
values ('65000000-0000-4000-a000-000000000001', '64000000-0000-4000-a000-000000000001', 0, 'prose', 'Fiktiv dækning.', '{}', 1, 1, 0, 15, repeat('9', 64), 15, 4);
update knowledge.document_versions set chunker_version = 'structure/1' where id = '64000000-0000-4000-a000-000000000001';
insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
select '65000000-0000-4000-a000-000000000001', id, ('[' || array_to_string(array_fill(0.01::numeric, array[1024]), ',') || ']')::extensions.vector, 'da', repeat('a', 64)
from pgtap_model;
update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'under_review' where id = '64000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now() where id = '64000000-0000-4000-a000-000000000001';

grant evaluation_publisher_login to postgres with inherit false, set true;
select ops.evaluation_publisher_prepare();

-- ----------------------------------------------------------------------------
-- 1. Roller og rettigheder (D-18): mindst mulige rettigheder, ingen omvej for nogen
-- ----------------------------------------------------------------------------

select ok((select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls
           from pg_roles where rolname = 'evaluation_publisher'), 'gruppen evaluation_publisher er NOLOGIN uden særlige attributter');
select ok((select not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls and rolconnlimit = 2
           from pg_roles where rolname = 'evaluation_publisher_login'), 'login-rollen har ingen særlige attributter og højst 2 forbindelser');
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C") from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'
     and has_schema_privilege('evaluation_publisher', n.oid, 'USAGE') and has_function_privilege('evaluation_publisher', p.oid, 'EXECUTE')),
  array['knowledge.record_evaluation_run(jsonb)', 'knowledge.register_evaluation_gate_set(jsonb)'],
  'publisheren kan kun køre de to publiceringsfunktioner');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'knowledge' and c.relkind in ('r', 'v', 'm', 'p')
     and has_table_privilege('evaluation_publisher', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')), 0,
  'publisheren har ingen tabelrettigheder');
select is((ops.evaluation_publisher_status() -> 'violations'), '[]'::jsonb, 'ops.evaluation_publisher_status melder ingen overtrædelser');
select ok(not has_function_privilege(r, 'knowledge.record_evaluation_run(jsonb)', 'EXECUTE')
          and not has_function_privilege(r, 'knowledge.register_evaluation_gate_set(jsonb)', 'EXECUTE'),
          format('%s kan ikke publicere evalueringer', r))
from unnest(array['anon', 'authenticated', 'service_role']) r;
select ok(not has_table_privilege(r, format('knowledge.%I', t), 'INSERT') and not has_table_privilege(r, format('knowledge.%I', t), 'UPDATE')
          and not has_table_privilege(r, format('knowledge.%I', t), 'DELETE') and not has_table_privilege(r, format('knowledge.%I', t), 'TRUNCATE'),
          format('%s kan ikke skrive i %s', r, t))
from unnest(array['authenticated', 'service_role']) r,
     unnest(array['retrieval_configurations', 'evaluation_runs', 'evaluation_gate_sets', 'retrieval_configuration_transitions']) t;
select ok(not has_table_privilege('service_role', 'knowledge.retrieval_configurations', 'SELECT'), 'service_role kan ikke læse registret');
select ok(not has_function_privilege('service_role', f, 'EXECUTE'), format('service_role kan ikke køre %s', f))
from unnest(array['knowledge.retrieval_context()', 'knowledge.approve_retrieval_configuration(uuid,uuid,jsonb)',
                  'knowledge.activate_retrieval_configuration(uuid)', 'knowledge.suspend_retrieval_configuration(uuid,text)',
                  'knowledge.suspend_retrieval_configuration_internal(uuid,text,uuid,text)']) f;
select ok(not has_function_privilege('authenticated', 'knowledge.suspend_retrieval_configuration_internal(uuid,text,uuid,text)', 'EXECUTE'),
  'den interne suspendering kan ikke kaldes af nogen app-rolle');

-- ----------------------------------------------------------------------------
-- 1b. TypeScript og databasen regner ens: den uændrede, genererede rapport efterprøves i SQL
-- ----------------------------------------------------------------------------

select is(knowledge.checksum_of((pg_temp.ts_report() - 'checksums') || jsonb_build_object('checksums', jsonb_build_object('results', pg_temp.ts_report() #> '{checksums,results}'))),
  pg_temp.ts_report() #>> '{checksums,report}', 'rapportens checksum genberegnes identisk i SQL (kanonisk JSON)');
select is(knowledge.retrieval_fingerprint(pg_temp.ts_report() #> '{configuration,declared}'), pg_temp.ts_report() #>> '{configuration,declaredFingerprint}',
  'konfigurationens fingeraftryk genberegnes identisk i SQL');
select is(knowledge.checksum_of(pg_temp.ts_gates()), pg_temp.ts_report() #>> '{gateSet,checksum}', 'gate-sættets checksum genberegnes identisk i SQL');
select is(knowledge.eval_report_problems(pg_temp.ts_report(), pg_temp.ts_gates()), '{}'::text[],
  'metrics, Wilson-intervaller, gates, minimum, tier og afgørelse genberegnes uden afvigelser');

create temp table pgtap_fp as select pg_temp.base_report() #>> '{configuration,declaredFingerprint}' as fp;
grant select on pgtap_fp to public;

-- ----------------------------------------------------------------------------
-- 2. Gate-sættet: registreres af publisheren, godkendes af et menneske, ændres aldrig
-- ----------------------------------------------------------------------------

create temp table pgtap_gate as select pg_temp.register_gates(pg_temp.gates()) as id;
grant select on pgtap_gate to public;
select is((select approved_at from knowledge.evaluation_gate_sets where id = (select id from pgtap_gate)), null, 'et gate-sæt registreres ugodkendt');
select throws_like($$ select pg_temp.publish(pg_temp.base_report()) $$, '%Afvist (gate_set)%', 'en kørsel mod et ugodkendt gate-sæt afvises');
select is(pg_temp.register_gates(pg_temp.gates())::text, (select id from pgtap_gate)::text, 'registreringen er idempotent på checksum');
select throws_like($$ select pg_temp.register_gates(jsonb_set(pg_temp.gates(), '{quality,Q1,threshold}', '0.5')) $$,
  '%Afvist (gate_set)%', 'en ændret tærskel med samme id og version afvises — rekalibrering kræver en ny version');
select throws_like($$ select pg_temp.register_gates(jsonb_set(pg_temp.gates(), '{quality,Q5,comparator}', '">="')) $$,
  '%låste metrik og retning%', 'metrik og retning er låst i koden');

select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.approve_evaluation_gate_set(%L) $$, (select id from pgtap_gate)), '42501', null,
  'en rådgiver kan ikke godkende et gate-sæt');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_evaluation_gate_set(%L) $$, (select id from pgtap_gate)),
  'en administrator med system.settings.manage godkender gate-sættet');
select throws_ok($$ update knowledge.evaluation_gate_sets set k = 3 $$, '42501', null, 'administratoren kan ikke rette et gate-sæt direkte');
reset role;
select throws_like($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.evaluation_gate_sets set k = 3 $$,
  '%kan ikke ændres%', 'et godkendt gate-sæt kan ikke ændres — heller ikke af ejeren');
select set_config('knowledge.registry_write', '', true);

-- ----------------------------------------------------------------------------
-- 3. record_evaluation_run genberegner alt og afviser det, der ikke stemmer
-- ----------------------------------------------------------------------------

select throws_like($$ select pg_temp.publish(jsonb_set(pg_temp.base_report(), '{metrics,mrr_at_k,value}', '0.5')) $$,
  '%Afvist (report_checksum)%', 'en rapport, der er ændret efter kørslen, afvises (checksum)');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{metrics,source_recall_at_k,value}', '0.99'))) $$,
  '%Afvist (recomputation)%Source Recall%', 'redigerede metrics afvises, også med nye checksums');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{cases,0,sourceRank}', 'null'))) $$,
  '%Afvist (recomputation)%', 'ændrede observationer afvises (metrics kan ikke genberegnes)');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{qualityGates,0,status}', '"fail"'))) $$,
  '%Afvist (recomputation)%Kvalitetsgate Q1%', 'et redigeret gate-resultat afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{verdict}', '"uncertain"'))) $$,
  '%Afvist (recomputation)%Afgørelsen stemmer ikke%', 'en redigeret afgørelse afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{tier}', '"standard"'))) $$,
  '%Afvist (recomputation)%Tier%', 'en redigeret tier afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{hardGates,0,violations}', '1'))) $$,
  '%Afvist (recomputation)%hårde gates%', 'redigerede hårde gates afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{production,eligible}', 'true'))) $$,
  '%Afvist (self_certified)%', 'en rapport kan ikke erklære sig selv production-egnet');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{configuration,environment}', '"fixture"'))) $$,
  '%Afvist (invalid_run)%', 'udviklings- eller fixture-evidens kan aldrig registreres (H7)');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{configuration,declaredFingerprint}', to_jsonb(repeat('0', 64))))) $$,
  '%Afvist (fingerprint)%', 'et fingeraftryk, der ikke er materialets, afvises');
select throws_like($$ select pg_temp.publish(pg_temp.with_h6_breach(pg_temp.base_report())) $$,
  '%Afvist (invalid_run)%H6%', 'evalueret som A, kørt som B: kørslen dokumenterer ikke konfigurationen og kan ikke registreres (H6)');
select throws_like($$ select pg_temp.publish(pg_temp.with_material(pg_temp.base_report(), pg_temp.material('{reranker,id}', '"none"'), 'run-none')) $$,
  '%Afvist (development)%', 'en konfiguration med "none" kan ikke registreres');
select throws_like($$ select pg_temp.publish(pg_temp.with_material(pg_temp.base_report(), pg_temp.material('{embedding,provider}', '"test"'), 'run-test')) $$,
  '%Afvist (development)%', 'en konfiguration med test-embedderen kan ikke registreres');
select throws_like($$ select pg_temp.publish(pg_temp.with_material(pg_temp.base_report(), pg_temp.material('{embedding,modelVersion}', '"ukendt"'), 'run-model')) $$,
  '%Afvist (model)%', 'en konfiguration med en ukendt embedding-model afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{corpus,documentTypes}', '["opfundet"]'))) $$,
  '%Afvist (corpus)%', 'ukendte dokumenttyper i korpusset afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{gateSet,checksum}', to_jsonb(repeat('e', 64))))) $$,
  '%Afvist (gate_set)%', 'et gate-sæt, der ikke er registreret, afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{reportSchema}', '2'))) $$,
  '%Afvist (format)%', 'kun det understøttede rapportformat accepteres');

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.record_evaluation_run('{}'::jsonb) $$, '42501', null, 'en administrator kan ikke registrere en kørsel');
reset role;
select throws_ok($$ select knowledge.record_evaluation_run(pg_temp.base_report()) $$, '42501', null, 'heller ikke ejeren uden publisherens identitet');

create temp table pgtap_runs (name text primary key, id uuid);
grant select on pgtap_runs to public;
insert into pgtap_runs select 'a1', pg_temp.publish(pg_temp.base_report());
select pass('en korrekt rapport registreres af evaluation_publisher');
select is((select status from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')), 'candidate',
  'konfigurationen oprettes som kandidat');
select ok((select passed and tier = 'pilot' and verdict = 'pass' and valid from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')),
  'kørslen er bestået, gyldig og pilot (under 100 spørgsmål)');
select is((select evaluated_document_types from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')), array['terms'],
  'kørslen husker de evaluerede dokumenttyper (pilot-scope)');
select is((select fingerprint from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')),
  pg_temp.base_report() #>> '{configuration,declaredFingerprint}', 'konfigurationens fingeraftryk er det, TypeScript beregnede');
select throws_like($$ select pg_temp.publish(pg_temp.base_report()) $$, '%Afvist (duplicate)%', 'samme kørsel kan ikke registreres to gange');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.evaluation_run.published'
                  and details ->> 'report_checksum' = pg_temp.base_report() #>> '{checksums,report}'
                  and details ->> 'fingerprint' = pg_temp.base_report() #>> '{configuration,declaredFingerprint}'),
  'publiceringen auditeres med checksums og fingeraftryk');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.retrieval_configuration.candidate_created'), 'kandidaten auditeres');

-- ----------------------------------------------------------------------------
-- 4. Ingen kan skrive direkte; tilstandsmaskinen og uforanderligheden holder
-- ----------------------------------------------------------------------------

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok(format($$ update knowledge.retrieval_configurations set status = 'active' where id = %L $$, pg_temp.cfg('pgtap-bedrock')), '42501', null,
  'administratoren kan ikke sætte status direkte (UPDATE)');
select throws_ok($$ update knowledge.evaluation_runs set verdict = 'pass' $$, '42501', null, 'administratoren kan ikke rette en kørsel');
select throws_ok($$ insert into knowledge.retrieval_configuration_transitions (configuration_id, to_status, actor_role) values (gen_random_uuid(), 'active', 'x') $$,
  '42501', null, 'administratoren kan ikke skrive statushistorik');
select throws_ok(format($$ delete from knowledge.retrieval_configurations where id = %L $$, pg_temp.cfg('pgtap-bedrock')), '42501', null,
  'administratoren kan ikke slette en konfiguration');
reset role;
select throws_like(format($$ update knowledge.retrieval_configurations set status = 'approved' where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%ændres kun gennem dets funktioner%', 'heller ikke ejeren kan ændre status uden om funktionerne');
select throws_like(format($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.retrieval_configurations set material = jsonb_set(material, '{params,topK}', '3') where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%ændres aldrig%', 'materialet er uforanderligt');
select throws_like(format($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.retrieval_configurations set status = 'active', activated_at = now() where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%ikke tilladt%', 'en kandidat kan ikke springe direkte til aktiv');
select throws_like($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.evaluation_runs set verdict = 'pass' $$,
  '%kan ikke ændres eller slettes%', 'en registreret kørsel er append-only — metrics kan ikke rettes bagefter');
select throws_like(format($$ delete from knowledge.retrieval_configurations where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%slettes aldrig%', 'en konfiguration slettes aldrig');
select set_config('knowledge.registry_write', '', true);

-- ----------------------------------------------------------------------------
-- 5. Godkendelse kræver system.settings.manage og en bestået kørsel af netop konfigurationen
-- ----------------------------------------------------------------------------

-- Konfiguration B (andre parametre) registreres også.
insert into pgtap_runs select 'b1', pg_temp.publish(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{params,minScore}', '0.2'), 'run-b1'));

select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'a1')),
  '42501', null, 'en rådgiver kan ikke godkende en konfiguration');
select is((select count(*)::int from knowledge.retrieval_configurations), 0, 'en rådgiver kan ikke læse registret');
reset role;

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'b1')),
  '%kørslen gælder en anden konfiguration%', 'evalueret som B kan ikke godkende A');
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')),
  '%kun en godkendt konfiguration kan aktiveres%', 'en kandidat kan ikke aktiveres uden godkendelse');
select throws_like($$ select knowledge.activate_embedding_model('61000000-0000-4000-a000-000000000002') $$,
  '%godkendt retrieval-konfiguration%', 'en embedding-model kan ikke aktiveres uden en godkendt konfiguration (§2.7)');
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'a1')),
  'administratoren godkender A med dens beståede kørsel');
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'approved'), 1, 'administratoren kan læse historikken');
reset role;
select ok((select status = 'approved' and tier = 'pilot' and approval_run_id = (select id from pgtap_runs where name = 'a1')
                  and approved_by = (select id from identity.users where auth_id = '60000000-0000-4000-a000-000000000001')
           from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')),
  'godkendelsen registrerer kørslen, tier og den godkendende bruger');
select ok(exists (select 1 from knowledge.retrieval_configuration_transitions where configuration_id = pg_temp.cfg('pgtap-bedrock') and to_status = 'approved'),
  'statusskiftet står i historikken');

-- ----------------------------------------------------------------------------
-- 6. Aktivering i én transaktion, med modelskifte og pilot-scope
-- ----------------------------------------------------------------------------

-- Et publiceret dokument af en type, kørslen ikke evaluerede, blokerer aktiveringen.
update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000002';
update knowledge.document_versions set status = 'under_review' where id = '64000000-0000-4000-a000-000000000002';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now() where id = '64000000-0000-4000-a000-000000000002';
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')),
  '%Afvist (scope)%acceptance_rules%', 'en pilot-godkendelse gælder kun de evaluerede dokumenttyper — en ny type kræver en ny kørsel');
reset role;
update knowledge.document_versions set status = 'withdrawn', withdrawn_at = now(), withdrawal_category = 'other', withdrawal_reason = 'pgTAP'
  where id = '64000000-0000-4000-a000-000000000002';

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')), 'A aktiveres');
reset role;
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'active'), 1, 'præcis én konfiguration er aktiv');
select is((select status from knowledge.embedding_models where id = (select id from pgtap_model)), 'active',
  'konfigurationens embedding-model blev aktiv i samme transaktion');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.retrieval_configuration.activated' and entity_id = pg_temp.cfg('pgtap-bedrock')::text
                  and details ->> 'fingerprint' = pg_temp.base_report() #>> '{configuration,declaredFingerprint}'), 'aktiveringen auditeres');

-- Retrieval-konteksten (P1, P3, P6, P9) som den indloggede rådgiver.
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'true', 'den aktive, godkendte konfiguration er klar til production-evidens');
select is(knowledge.retrieval_context() #>> '{executedAs,role}', 'authenticated', 'konteksten viser, at kaldet kører som den indloggede bruger (P6)');
select is(knowledge.retrieval_context() #>> '{configuration,fingerprint}', (select fp from pgtap_fp), 'konteksten bærer fingeraftrykket (P4, P9)');
select is((knowledge.retrieval_context() -> 'configuration') ? 'grade', false, 'konteksten har ingen grad — graden afledes ved hvert retrieval');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select chunker_version from knowledge.search_chunks('dækning', null, null) limit 1), 'structure/1', 'search_chunks returnerer chunker-versionen (P7)');
reset role;

-- Udfasede versioner: P5 og I5 er uændrede — en version uden frigivelse kan ikke publiceres.
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('64000000-0000-4000-a000-000000000003', '63000000-0000-4000-a000-000000000001', '2', '2021-01-01', 'r/3.pdf', repeat('b', 64));
select throws_like($$ update knowledge.document_versions set status = 'processing' where id = '64000000-0000-4000-a000-000000000003';
                     update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000003' $$,
  '%sikkerhedskontrollen%', 'I5 er uændret: en version uden frigivelse kan ikke blive behandlet eller publiceret');

-- ----------------------------------------------------------------------------
-- 7. Udskiftning: B erstatter A atomisk; A kan ikke genaktiveres uden en ny kørsel
-- ----------------------------------------------------------------------------

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 2), (select id from pgtap_runs where name = 'b1')),
  'B godkendes');
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 2)), 'B aktiveres');
reset role;
select is((select array_agg(status order by version) from knowledge.retrieval_configurations where label = 'pgtap-bedrock'), array['retired', 'active'],
  'A er udfaset og B aktiv — aldrig to aktive');
select is((select retirement_reason from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')), 'replaced', 'A er erstattet');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.retrieval_configuration.replaced' and entity_id = pg_temp.cfg('pgtap-bedrock')::text),
  'udskiftningen auditeres');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')),
  '%kun en godkendt%', 'en udfaset konfiguration kan ikke genaktiveres direkte');
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'a1')),
  '%Afvist (reapproval)%', 'genaktivering kræver en ny kørsel efter udfasningen');
reset role;

-- ----------------------------------------------------------------------------
-- 8. Suspendering (D-8): en fejlet hård gate i regression suspenderer straks; ingen fallback
-- ----------------------------------------------------------------------------

insert into pgtap_runs select 'b2', pg_temp.publish(pg_temp.with_h1_breach(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{params,minScore}', '0.2'), 'x'), 'run-b2'));
select ok((select status = 'suspended' and suspension_reason = 'hard_gate_failed' and suspension_run_id = (select id from pgtap_runs where name = 'b2')
           from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock', 2)),
  'en registreret regressionskørsel med en fejlet hård gate suspenderer B i samme transaktion');
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'active'), 0,
  'ingen automatisk fallback til en anden konfiguration');
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'false', 'den suspenderede konfiguration kan ikke give production-evidens (P3)');
select ok((knowledge.retrieval_context() #> '{configuration,notReady}') ? 'suspended', 'konteksten siger hvorfor');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 2)),
  '%kun en godkendt%', 'en suspenderet konfiguration kan ikke aktiveres igen');
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 2), (select id from pgtap_runs where name = 'b1')),
  '%Afvist (reapproval)%', 'den gamle beståede kørsel kan ikke bruges igen efter suspenderingen');
reset role;
insert into pgtap_runs select 'b3', pg_temp.publish(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{params,minScore}', '0.2'), 'run-b3'));
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 2), (select id from pgtap_runs where name = 'b3')),
  'en ny bestået kørsel efter suspenderingen kan godkendes');
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 2)), 'og aktiveres igen');
reset role;

-- Manuel suspendering (den operation, I7 også kan bruge via record_evaluation_run).
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.suspend_retrieval_configuration(%L, 'pgTAP: rådgiverens forsøg') $$, pg_temp.cfg('pgtap-bedrock', 2)), '42501', null,
  'en rådgiver kan ikke suspendere');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.suspend_retrieval_configuration(%L, 'kort') $$, pg_temp.cfg('pgtap-bedrock', 2)),
  '%begrundelse%', 'en suspendering kræver en begrundelse');
select lives_ok(format($$ select knowledge.suspend_retrieval_configuration(%L, 'pgTAP: fiktiv faglig vurdering') $$, pg_temp.cfg('pgtap-bedrock', 2)),
  'administratoren suspenderer');
select throws_like(format($$ select knowledge.retire_retrieval_configuration(%L, 'pgTAP: udfases efter suspendering') $$, gen_random_uuid()),
  '%kun en kandidat%', 'kun kendte konfigurationer kan udfases');
select lives_ok(format($$ select knowledge.retire_retrieval_configuration(%L, 'pgTAP: udfases efter suspendering') $$, pg_temp.cfg('pgtap-bedrock', 2)),
  'en suspenderet konfiguration udfases');
reset role;
select is((select count(*)::int from knowledge.retrieval_configurations where label = 'pgtap-bedrock'), 2, 'udfasede konfigurationer slettes aldrig');
select is((select count(*)::int from knowledge.evaluation_runs where configuration_id in (pg_temp.cfg('pgtap-bedrock'), pg_temp.cfg('pgtap-bedrock', 2))), 4,
  'alle kørsler er bevaret og kan forklare evidensen bagefter');
select ok((select bool_and(details ? 'fingerprint') from audit.audit_log
           where action in ('knowledge.retrieval_configuration.approved', 'knowledge.retrieval_configuration.activated',
                            'knowledge.retrieval_configuration.suspended', 'knowledge.retrieval_configuration.retired')),
  'alle livscyklus-hændelser auditeres med fingeraftryk');

-- ----------------------------------------------------------------------------
-- 9. En konfiguration, hvis chunker-version ikke findes i korpusset, kan ikke aktiveres
-- ----------------------------------------------------------------------------

insert into pgtap_runs select 'c1', pg_temp.publish(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{chunkerVersions}', '["structure/9"]'), 'run-c1'));
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 3), (select id from pgtap_runs where name = 'c1')),
  'C godkendes');
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 3)),
  '%Afvist (chunker)%structure/9%', 'chunker-versioner, der ikke findes i korpusset, blokerer aktiveringen');
reset role;

select * from finish();
rollback;
