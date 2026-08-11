import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { MAX_BOOK_BYTES, projectTitleSchema } from '../../shared/contracts';
import { createProject } from '../api';

export function NewProjectPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [bookText, setBookText] = useState('');
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedTitle = projectTitleSchema.safeParse(title);
    if (!parsedTitle.success) {
      setError(parsedTitle.error.issues[0]?.message ?? 'Project title is required.');
      return;
    }

    const hasText = bookText.trim().length > 0;
    const hasFile = Boolean(bookFile);
    if (hasText === hasFile) {
      setError('Provide exactly one book source: pasted text or one .txt file.');
      return;
    }

    if (bookFile && (!bookFile.name.toLowerCase().endsWith('.txt') || bookFile.size > MAX_BOOK_BYTES)) {
      setError('Choose a UTF-8 .txt file no larger than 2 MiB.');
      return;
    }

    if (hasText && new Blob([bookText]).size > MAX_BOOK_BYTES) {
      setError('Book text must be 2 MiB or smaller.');
      return;
    }

    setSubmitting(true);
    try {
      const project = await createProject(parsedTitle.data, bookText, bookFile);
      navigate(`/projects/${project.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Project could not be created.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="content-page narrow-page" id="main-content" tabIndex={-1}>
      <Link className="back-link" to="/projects">← Back to projects</Link>
      <div className="form-heading">
        <p className="eyebrow">New project</p>
        <h1>Bring in a book</h1>
        <p>Give the project a title, then provide exactly one source for its text.</p>
      </div>
      <form className="project-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label>
          Project title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The Wind in the Willows"
          />
        </label>

        <label className="file-picker">
          <span>Upload a .txt file</span>
          <input
            accept=".txt,text/plain"
            type="file"
            onChange={(event) => setBookFile(event.target.files?.[0] ?? null)}
          />
          <small>{bookFile ? bookFile.name : 'UTF-8 plain text, up to 2 MiB'}</small>
        </label>

        <div className="or-divider"><span>or paste text</span></div>

        <label>
          Book text
          <textarea
            rows={10}
            value={bookText}
            onChange={(event) => setBookText(event.target.value)}
            placeholder="Once upon a time…"
          />
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button full-width" disabled={submitting} type="submit">
          {submitting ? 'Creating project…' : 'Create project'}
        </button>
      </form>
    </main>
  );
}
