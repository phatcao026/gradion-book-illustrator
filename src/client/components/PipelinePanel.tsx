import {
  PIPELINE_STEPS,
  type PipelineState,
  type PipelineStepNumber,
} from '../../shared/contracts';

interface PipelinePanelProps {
  pipeline: PipelineState;
  recovering?: boolean;
  onRecover?: () => void;
}

export function PipelinePanel({
  pipeline,
  recovering = false,
  onRecover,
}: PipelinePanelProps) {
  const activeName = stepName(pipeline.activeStep);
  const nextName = stepName(pipeline.nextStep);

  return (
    <section className="pipeline-panel" aria-labelledby="pipeline-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Illustration pipeline</p>
          <h2 id="pipeline-title">{pipeline.completedStep} of 5 steps complete</h2>
        </div>
      </div>

      <ol className="step-preview" aria-label="Illustration progress">
        {PIPELINE_STEPS.map((step, index) => {
          const number = (index + 1) as PipelineStepNumber;
          const className =
            number <= pipeline.completedStep
              ? 'complete'
              : number === pipeline.activeStep ||
                  (pipeline.activeStep === null && number === pipeline.nextStep)
                ? 'current'
                : '';

          return (
            <li className={className} key={step}>
              <span>{number}</span>
              {formatStepName(step)}
            </li>
          );
        })}
      </ol>

      <div className={`pipeline-state ${pipeline.runState.toLowerCase()}`}>
        {pipeline.completedStep === 5 ? (
          <>
            <strong>Illustration pipeline complete</strong>
            <p>All five steps have been saved.</p>
          </>
        ) : pipeline.runState === 'RUNNING' && pipeline.isStale ? (
          <>
            <strong>{activeName} appears interrupted</strong>
            <p>The attempt has exceeded the configured stale threshold.</p>
            <button
              className="secondary-button"
              disabled={recovering || !onRecover}
              onClick={onRecover}
              type="button"
            >
              {recovering ? 'Recovering…' : 'Recover interrupted attempt'}
            </button>
          </>
        ) : pipeline.runState === 'RUNNING' ? (
          <>
            <strong>{activeName} is running</strong>
            <p>The current action remains disabled until this attempt finishes.</p>
            <button className="primary-button" disabled type="button">
              {activeName} in progress…
            </button>
          </>
        ) : pipeline.runState === 'FAILED' ? (
          <>
            <strong>{activeName} failed</strong>
            <p role="alert">{pipeline.error?.message ?? 'The step did not finish.'}</p>
            <button className="primary-button" disabled type="button">
              Retry {activeName} — available in M3
            </button>
          </>
        ) : pipeline.runState === 'INTERRUPTED' ? (
          <>
            <strong>{activeName} was interrupted</strong>
            <p>{pipeline.error?.message ?? 'The attempt is safe to retry.'}</p>
            <button className="primary-button" disabled type="button">
              Retry {activeName} — available in M3
            </button>
          </>
        ) : (
          <>
            <strong>{nextName} is ready</strong>
            <p>Pipeline execution will be connected to Gemini in Milestone 3.</p>
            <button className="primary-button" disabled type="button">
              Generate {nextName} — available in M3
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function stepName(step: PipelineStepNumber | null): string {
  return step === null ? 'Next step' : formatStepName(PIPELINE_STEPS[step - 1]);
}

function formatStepName(step: (typeof PIPELINE_STEPS)[number]): string {
  return `${step.charAt(0)}${step.slice(1).toLowerCase()}`;
}
