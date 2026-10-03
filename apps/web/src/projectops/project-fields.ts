export const projectFields = `<label>Project title<input name="title" required maxlength="160"></label>
  <label>Brief<textarea name="brief" required maxlength="4000" rows="5"></textarea></label>
  <label>Budget range<input name="budgetRange" maxlength="120"></label>
  <label for="project-priority">Priority</label><select id="project-priority" name="priority"><option>low</option><option selected>medium</option><option>high</option></select>
  <label>Deadline (UTC)<input name="deadlineIso" type="datetime-local" step="1"></label>`;

export const projectInputScript = `function projectInput(form){const data=Object.fromEntries(new FormData(form));return {title:data.title,brief:data.brief,budgetRange:data.budgetRange.trim()||undefined,priority:data.priority,deadlineIso:data.deadlineIso?new Date(data.deadlineIso+'Z').toISOString():undefined};}`;
