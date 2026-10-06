# Demo screen

Mode: Operate. Target: `public/index.html`, with `public/app.css` and `public/app.js`.

## Direction contract

THESIS: A small, functional screen makes the reservation API usable without Swagger. The user explicitly asks for simplicity and little frontend effort.

OWN-WORLD: Light neutral background, white sections, dark text, one restrained blue action color, system typography, native form controls, and simple tables. Implementation choices stay subordinate to the brief.

STORY: Sign in, select an organization, view availability, reserve seats, then confirm or cancel. Owners can create events; users can create an organization when they have none.

Extension: owners and managers can read organization-wide reservations and action history in two standard tables below their personal reservations. Members retain the personal workflow. All four lists clear before an organization change loads new data.

FIRST VIEWPORT: A short MOZKAN header with documentation link, then the login form. After login the organization selector and event list take priority, with personal reservations below. Mobile content stacks vertically.

FORM: Plain code-led forms and lists, selected directly from the user's simple-frontend request. No visual concept selection or image generation is needed for this bounded addition.

FINISH: Check the real flows in desktop and mobile browsers, review the rendered screen, and record the small visual system. No unimplemented controls or invented data.
