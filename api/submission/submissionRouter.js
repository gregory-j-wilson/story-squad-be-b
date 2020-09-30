const router = require('express').Router();
const Submissions = require('./submissionModel');
const authRequired = require('../middleware/authRequired');
const fileUploadHandler = require('../middleware/fileUpload');
const _omit = require('lodash.omit');

/**
 * Schemas for submission data types.
 * @swagger
 * components:
 *  schemas:
 *    SubmissionStatus:
 *      type: object
 *      properties:
 *        ID:
 *          type: integer
 *        ChildID:
 *          type: integer
 *        StoryID:
 *          type: integer
 *        HasRead:
 *          type: boolean
 *        HasWritten:
 *          type: boolean
 *        HasDrawn:
 *          type: boolean
 *        Complexity:
 *          type: integer
 *      example:
 *        ID: 1
 *        ChildID: 1
 *        StoryID: 1
 *        HasRead: false
 *        HasWritten: false
 *        HasDrawn: false
 *        Complexity: null
 *    DrawnSubmission:
 *      type: object
 *      properties:
 *        ID:
 *          type: integer
 *        URL:
 *          type: string
 *      example:
 *        ID: 1
 *        URL: http://someurl.com
 *    WrittenSubmission:
 *      allOf:
 *        - $ref: '#/components/schemas/DrawnSubmission'
 *        - type: object
 *          properties:
 *            PageNum:
 *              type: integer
 *          example:
 *            PageNum: 1
 *
 *  parameters:
 *    submissionId:
 *      name: Submission ID
 *      in: path
 *      description: ID of the desired submission
 *      required: true
 *      example: 1
 *      schema:
 *        type: integer
 */

/**
 * @swagger
 * /submission?childId={childId}&storyId={storyId}:
 *  get:
 *    summary: Queries the database for information for the given submission.
 *    description: Attempts to query the database to find a submission entry at the intersection
 *      of the given Child ID and Story ID. If none is found, one will be created and initialized
 *      with all false/null values.
 *    security:
 *      - okta: []
 *    tags:
 *      - Submissions
 *    parameters:
 *      - in: query
 *        name: childId
 *        schema:
 *          type: integer
 *        required: true
 *        description: numeric ID of child
 *      - in: query
 *        name: storyId
 *        schema:
 *          type: integer
 *        required: true
 *        description: numeric ID of story
 *    responses:
 *      200:
 *        description: Returns an object containing the data for the requested submission
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/SubmissionStatus'
 *      400:
 *        $ref: '#/components/responses/MissingParameters'
 *      401:
 *        $ref: '#/components/responses/UnauthorizedError'
 *      404:
 *        $ref: '#/components/responses/InvalidID'
 *      500:
 *        $ref: '#/components/responses/DatabaseError'
 */
router.get('/', authRequired, async (req, res) => {
  const { childId, storyId } = req.query;

  // Check to make sure both IDs are given
  if (!childId || !storyId) {
    return res.status(400).json({ error: 'Missing parameters.' });
  }

  try {
    const sub = await Submissions.getOrInitSubmission(childId, storyId);
    res.status(200).json(sub);
  } catch ({ message }) {
    if (message.includes('violates foreign key constraint')) {
      res.status(404).json({ error: 'InvalidID' });
    } else {
      res.status(500).json({ message });
    }
  }
});

/**
 * @swagger
 * /submit/read/{id}:
 *  put:
 *    summary: Attempts to mark the submission with the given ID as 'read'
 *    security:
 *      - okta: []
 *    tags:
 *      - Submissions
 *    parameters:
 *      - $ref: '#/components/parameters/submissionId'
 *    responses:
 *      204:
 *        $ref: '#/components/responses/EmptySuccess'
 *      401:
 *        $ref: '#/components/responses/UnauthorizedError'
 *      404:
 *        $ref: '#/components/responses/NotFound'
 *      500:
 *        $ref: '#/components/responses/DatabaseError'
 */
router.put('/read/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const count = await Submissions.markAsRead(id);
    if (count > 0) {
      res.status(204).end();
    } else {
      res.status(404).json({ error: 'SubmissionNotFound' });
    }
  } catch ({ message }) {
    res.status(500).json({ message });
  }
});

/**
 * @swagger
 * /submit/write/{id}:
 *  post:
 *    summary: Attempts to upload pages for the submission with the given ID
 *    security:
 *      - okta: []
 *    tags:
 *      - Submissions
 *    parameters:
 *      - $ref: '#/components/parameters/submissionId'
 *      - in: formData
 *        name: pages
 *        type: file
 *        description: Image of the written page(s) to upload
 *    responses:
 *      201:
 *        description: Returns an array of all uploaded pages.
 *        content:
 *          application/json:
 *            schema:
 *              type: array
 *              items:
 *                $ref: '#/components/schemas/WrittenSubmission'
 *      401:
 *        $ref: '#/components/responses/UnauthorizedError'
 *      403:
 *        $ref: '#/components/responses/OneSubmission'
 *      404:
 *        $ref: '#/components/responses/NotFound'
 *      409:
 *        $ref: '#/components/responses/UploadFailed'
 *      500:
 *        $ref: '#/components/responses/DatabaseError'
 */
router.post('/write/:id', authRequired, fileUploadHandler, async (req, res) => {
  const { id } = req.params;
  const pages = req.body.pages.map((x, i) => ({
    URL: x.Location,
    PageNum: i + 1,
    SubmissionID: id,
    checksum: x.Checksum,
  }));
  try {
    // Upload the files AND mark them as written correctly at the same time
    const [submitted] = await Promise.all([
      Submissions.submitWriting(pages.map((x) => _omit(x, 'checksum'))),
      Submissions.markAsWritten(id),
    ]);
    // SEND TO DS FOR METRICS!!

    res.status(201).json(submitted);
  } catch ({ message }) {
    if (message.includes('violates foreign key constraint')) {
      res.status(404).json({ error: 'InvalidSubmissionID' });
    } else if (message.includes('violates unique constraint')) {
      res.status(403).json({ error: 'Only one submission allowed.' });
    } else {
      res.status(500).json({ message });
    }
  }
});

/**
 * @swagger
 * /submit/draw/{id}:
 *  post:
 *    summary: Attempts to upload a drawing for the submission with the given ID
 *    security:
 *      - okta: []
 *    tags:
 *      - Submissions
 *    parameters:
 *      - $ref: '#/components/parameters/submissionId'
 *      - in: formData
 *        name: drawing
 *        type: file
 *        description: Image of the drawing to upload
 *    responses:
 *      201:
 *        description: Returns the newly uploaded drawing.
 *        content:
 *          application/json:
 *            schema:
 *              $ref: '#/components/schemas/DrawnSubmission'
 *      401:
 *        $ref: '#/components/responses/UnauthorizedError'
 *      404:
 *        $ref: '#/components/responses/NotFound'
 *      409:
 *        $ref: '#/components/responses/UploadFailed'
 *      500:
 *        $ref: '#/components/responses/DatabaseError'
 */
router.post('/draw/:id', authRequired, fileUploadHandler, async (req, res) => {
  const { id } = req.params;
  const drawing = req.body.drawing.map((x) => ({
    URL: x.Location,
    SubmissionID: id,
    checksum: x.Checksum,
  }));
  try {
    // Upload the files AND mark them as written correctly at the same time
    const [[submitted]] = await Promise.all([
      Submissions.submitDrawing(drawing.map((x) => _omit(x, 'checksum'))),
      Submissions.markAsDrawn(id),
    ]);
    // SEND TO DS FOR METRICS!!

    res.status(201).json(submitted);
  } catch ({ message }) {
    if (message.includes('violates foreign key constraint')) {
      res.status(404).json({ error: 'InvalidSubmissionID' });
    } else if (message.includes('violates unique constraint')) {
      res.status(403).json({ error: 'Only one submission allowed.' });
    } else {
      res.status(500).json({ message });
    }
  }
});

module.exports = router;