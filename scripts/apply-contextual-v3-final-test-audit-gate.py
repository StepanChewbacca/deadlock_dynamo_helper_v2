from pathlib import Path

path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-final-test.service.ts')
source = path.read_text()
release_block = """      const releaseGate = buildContextualV3CandidateReleaseGate(
        coverageRate,
        deltas.top1Rate,
        deltas.top3Rate,
      );
"""
replacement = release_block + """      const uncoveredCount = decisionCount - coveredCount;
      const classifiedUncoveredCount = Object.values(diagnostics).reduce(
        (total, value) => total + value,
        0,
      );
      const auditPassed =
        descriptors.length === options.matchCount &&
        descriptors.every((descriptor) =>
          isStrictlyNewerThanCutoff(descriptor.startTime, cutoff),
        ) &&
        decisionCount > 0 &&
        matchesWithRows.size === descriptors.length &&
        duplicateDecisionCount === 0 &&
        incompleteRosterRowCount === 0 &&
        uncoveredCount === classifiedUncoveredCount &&
        diagnostics.unexplainedCount === 0;
      const shadowEligible = releaseGate.passed && auditPassed;
"""
if release_block not in source:
    raise RuntimeError('release gate block not found')
source = source.replace(release_block, replacement, 1)
source = source.replace(
    """        productionDecision: {
          status: releaseGate.passed ? 'ELIGIBLE_FOR_SHADOW_MODE' : 'BLOCKED',
          reason: releaseGate.passed
            ? 'The frozen model and candidate policy passed the strictly future final test.'
            : 'The strictly future final-test release gate failed.',
        },
      };
      const uncoveredCount = decisionCount - coveredCount;
      const classifiedUncoveredCount = Object.values(diagnostics).reduce(
        (total, value) => total + value,
        0,
      );
""",
    """        productionDecision: {
          status: shadowEligible ? 'ELIGIBLE_FOR_SHADOW_MODE' : 'BLOCKED',
          reason: shadowEligible
            ? 'The frozen model, candidate policy, release gate, and final-test audit passed.'
            : !auditPassed
              ? 'The strictly future final-test audit failed.'
              : 'The strictly future final-test release gate failed.',
        },
      };
""",
    1,
)
old_passed = """        passed:
          descriptors.length === options.matchCount &&
          descriptors.every((descriptor) =>
            isStrictlyNewerThanCutoff(descriptor.startTime, cutoff),
          ) &&
          decisionCount > 0 &&
          matchesWithRows.size === descriptors.length &&
          duplicateDecisionCount === 0 &&
          incompleteRosterRowCount === 0 &&
          uncoveredCount === classifiedUncoveredCount &&
          diagnostics.unexplainedCount === 0,
"""
if old_passed not in source:
    raise RuntimeError('audit passed block not found')
source = source.replace(old_passed, "        passed: auditPassed,\n", 1)
source = source.replace(
    """      if (!releaseGate.passed) {
        auditWarnings.push(
          'The future final-test release gate failed; shadow mode and production deployment remain blocked.',
        );
      }
""",
    """      if (!auditPassed) {
        auditWarnings.push(
          'The future final-test audit failed; shadow mode and production deployment remain blocked.',
        );
      }
      if (!releaseGate.passed) {
        auditWarnings.push(
          'The future final-test release gate failed; shadow mode and production deployment remain blocked.',
        );
      }
""",
    1,
)
path.write_text(source)
