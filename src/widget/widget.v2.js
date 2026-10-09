// ==============================================================================
// File: src/widget/widget.v2.js
// Description: The widget loader, VERSION 2. A customer pastes one script tag on their site and this file does the rest:
// it finds its own widget id, loads the widget's config from the API, draws a small form, and sends the submission back
// to the API across origins. Version 1 only drew a title and a button; it stays available at /widget.v1.js for old embeds.
// NOTE: the server removes these comment lines (and blank lines and indentation) before serving, so the public file stays small.
// RULE FOR EDITING THIS FILE: put every comment on its OWN line starting with //. Never put a comment after code on the same line.
// ==============================================================================
(function () {
  // The name of the hidden "honeypot" field. Humans never see it, bots fill it in. It must match HONEYPOT_FIELD on the server.
  var HONEYPOT_FIELD = 'website';
  // The browser sets document.currentScript to the <script> tag that is running this file right now
  var script = document.currentScript;
  // Without it we cannot find our widget id, so stop quietly
  if (!script || !script.src) {
    // Explain in the browser console (visible to the site owner, not to visitors)
    console.error('FlyRank Widget: cannot find its own script tag.');
    // Stop
    return;
  }
  // Holds the parsed script address
  var scriptUrl;
  // Parsing can throw if the address is malformed
  try {
    // Turn the script address text into a URL object
    scriptUrl = new URL(script.src);
  } catch (error) {
    // Explain in the console
    console.error('FlyRank Widget: the script address is not a valid URL.');
    // Stop
    return;
  }
  // The widget id comes from the query string of the script address: widget.v2.js?id=7
  var widgetId = scriptUrl.searchParams.get('id');
  // It must be plain digits (this also blocks anything that could be abused as a path)
  if (!/^\d+$/.test(widgetId || '')) {
    // Explain in the console
    console.error('FlyRank Widget: the script address needs ?id=<widget id>.');
    // Stop
    return;
  }
  // The API lives wherever this script was downloaded from, so we never need a hard-coded server address
  var apiBase = scriptUrl.origin;
  // Every widget gets its own container id, so the same script tag added twice does not draw two forms
  var containerId = 'flyrank-widget-' + widgetId;
  // If the widget is already on the page, do nothing
  if (document.getElementById(containerId)) {
    // Stop
    return;
  }

  // Helper: create an element, optionally with inline styles and PLAIN TEXT (textContent never runs HTML)
  function make(tag, css, text) {
    // Create the element in memory
    var node = document.createElement(tag);
    // Apply the styles when given
    if (css) {
      // Set all inline styles at once
      node.style.cssText = css;
    }
    // Set the text when given; textContent treats <tags> as literal characters, so owner-supplied text can never inject markup
    if (text) {
      // Put the text in as plain text
      node.textContent = text;
    }
    // Hand the element back
    return node;
  }

  // Helper: turn a field name such as "full_name" into a label such as "Full name"
  function labelFrom(name) {
    // Capitalise the first letter and replace underscores with spaces
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
  }

  // Helper: turn the owner's field list (from the widget config) into a safe, known shape. Unknown or invalid entries are skipped.
  function normalizeFields(raw) {
    // Use the list only if it really is a list
    var list = Array.isArray(raw) ? raw : [];
    // The cleaned result
    var out = [];
    // Look at each entry, but never draw more than 10 fields
    for (var i = 0; i < list.length && out.length < 10; i++) {
      // Take one entry
      var entry = list[i];
      // A plain string such as "email" is shorthand for { name: "email" }
      if (typeof entry === 'string') {
        // Expand the shorthand
        entry = { name: entry };
      }
      // Skip anything that is not an object with a text name
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
        // Move on to the next entry
        continue;
      }
      // Field names must be simple identifiers (letters, digits, underscore); this also blocks names such as __proto__
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(entry.name) || entry.name === HONEYPOT_FIELD) {
        // Move on to the next entry
        continue;
      }
      // Work out the input type: only text, email and textarea are allowed
      var type = ['text', 'email', 'textarea'].indexOf(entry.type) !== -1 ? entry.type : (entry.name === 'email' ? 'email' : (entry.name === 'feedback' || entry.name === 'message' ? 'textarea' : 'text'));
      // Keep the cleaned entry
      out.push({
        name: entry.name,
        label: typeof entry.label === 'string' && entry.label ? entry.label.slice(0, 80) : labelFrom(entry.name),
        type: type,
        required: entry.required === true
      });
    }
    // A form with no usable fields would be pointless, so fall back to a single required email field
    if (out.length === 0) {
      // The fallback field
      out.push({ name: 'email', label: 'Email', type: 'email', required: true });
    }
    // Hand the cleaned list back
    return out;
  }

  // Draws the widget once the config has arrived
  function render(widgetName, config) {
    // Choose the title: the config title, else the widget name, else a default
    var title = typeof config.title === 'string' && config.title ? config.title : (typeof widgetName === 'string' && widgetName ? widgetName : 'Contact us');
    // The button label, with a default
    var buttonText = typeof config.buttonText === 'string' && config.buttonText ? config.buttonText : 'Submit';
    // The message shown after a successful submission, with a default
    var successMessage = typeof config.successMessage === 'string' && config.successMessage ? config.successMessage : 'Thank you! We received your submission.';
    // The cleaned list of fields to draw
    var fields = normalizeFields(config.fields);

    // The outer box, pinned to the bottom-right corner of the visitor's window
    var container = make('div', 'position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:Arial,sans-serif;');
    // Give it its id (used above to avoid drawing the widget twice)
    container.id = containerId;
    // The white card
    var card = make('div', 'background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:16px;box-shadow:0 4px 12px rgba(0,0,0,.15);width:300px;max-width:calc(100vw - 40px);max-height:85vh;overflow:auto;box-sizing:border-box;color:#0f172a;');
    // The title
    card.appendChild(make('h4', 'margin:0 0 8px 0;font-size:16px;', title));
    // The optional description under the title
    if (typeof config.description === 'string' && config.description) {
      // Add the description paragraph
      card.appendChild(make('p', 'margin:0 0 12px 0;font-size:13px;color:#475569;', config.description));
    }

    // The form element
    var form = make('form');
    // Remember each real input by field name so the submit handler can read them
    var inputs = {};
    // Draw one row per field
    fields.forEach(function (field) {
      // A wrapper for the label and the input
      var row = make('div', 'margin-bottom:10px;');
      // The visible label; required fields get a star
      var label = make('label', 'display:block;font-size:13px;margin-bottom:4px;', field.label + (field.required ? ' *' : ''));
      // The input: a multi-line box for textarea, otherwise a one-line input
      var input = make(field.type === 'textarea' ? 'textarea' : 'input', 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #cbd5e1;border-radius:4px;font-size:14px;font-family:inherit;');
      // One-line inputs need their type (text or email)
      if (field.type !== 'textarea') {
        // Set the type
        input.type = field.type;
      }
      // The field name is the key the server will receive
      input.name = field.name;
      // Required fields use the browser's own validation
      input.required = field.required;
      // Limit the length so one visitor cannot send a huge payload
      input.maxLength = field.type === 'textarea' ? 1000 : 200;
      // Tie the label to the input so screen readers and clicks work
      input.id = containerId + '-' + field.name;
      // The matching "for" attribute on the label
      label.htmlFor = input.id;
      // Remember the input
      inputs[field.name] = input;
      // Assemble the row
      row.appendChild(label);
      // Add the input to the row
      row.appendChild(input);
      // Add the row to the form
      form.appendChild(row);
    });

    // The honeypot: an extra field placed far off-screen. People never see or tab to it; simple bots fill every field they find.
    var trap = make('div', 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;');
    // Hide it from screen readers too
    trap.setAttribute('aria-hidden', 'true');
    // The trap input
    var trapInput = make('input');
    // A normal-looking text input, so bots treat it like any other
    trapInput.type = 'text';
    // Its name is the honeypot field name the server looks for
    trapInput.name = HONEYPOT_FIELD;
    // Keyboard users must never land on it
    trapInput.tabIndex = -1;
    // Stop browsers from auto-filling it for real people
    trapInput.autocomplete = 'off';
    // Place the input in the trap box
    trap.appendChild(trapInput);
    // Place the trap box in the form
    form.appendChild(trap);

    // The submit button
    var button = make('button', 'background:#2563eb;color:#fff;border:none;padding:10px 12px;border-radius:4px;cursor:pointer;width:100%;font-weight:bold;font-size:14px;', buttonText);
    // Make it a submit button so Enter and clicks both submit the form
    button.type = 'submit';
    // Add the button to the form
    form.appendChild(button);
    // The line of text under the button that shows progress or errors
    var status = make('p', 'margin:10px 0 0 0;font-size:13px;min-height:1em;');
    // Screen readers announce changes to this line politely
    status.setAttribute('role', 'status');
    // Add the status line to the form
    form.appendChild(status);

    // Helper: show a message under the button, red for errors and green otherwise
    function setStatus(text, isError) {
      // Put the message in as plain text
      status.textContent = text;
      // Choose the colour
      status.style.color = isError ? '#b91c1c' : '#15803d';
    }

    // Helper: tell the host page what happened, so the site can react (the test page prints this)
    function announce(httpStatus, body) {
      // Dispatching an event can fail in very old browsers, and the widget must never break the host page
      try {
        // Send a browser event with the result details
        window.dispatchEvent(new CustomEvent('flyrank:submit-result', {
          detail: { widget_id: Number(widgetId), status: httpStatus, submission_id: body && body.submission_id ? body.submission_id : null }
        }));
      } catch (error) {
        // Ignore: announcing is optional
      }
    }

    // What happens when the visitor submits the form
    form.addEventListener('submit', function (event) {
      // Stop the browser from reloading the page
      event.preventDefault();
      // Ignore a second click while the first request is still running
      if (button.disabled) {
        // Stop
        return;
      }
      // The data to send, starting empty
      var data = {};
      // Copy each field's trimmed value
      Object.keys(inputs).forEach(function (name) {
        // Read and trim the value
        data[name] = inputs[name].value.trim();
      });
      // Include the honeypot exactly as it is: empty for people, filled for simple bots
      data[HONEYPOT_FIELD] = trapInput.value;
      // Tell the server which page the form was on (it must be a valid URL)
      var metadata = { page_url: window.location.href };
      // Add the referrer only when there is one
      if (document.referrer) {
        // Record where the visitor came from
        metadata.referrer = document.referrer;
      }
      // Stop double submissions and show progress
      button.disabled = true;
      // Show progress text
      setStatus('Sending...', false);
      // Send the submission to the API. Because the API is on another origin, the browser first sends an OPTIONS "preflight" request automatically.
      fetch(apiBase + '/api/embed/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_id: Number(widgetId), data: data, metadata: metadata })
      }).then(function (response) {
        // Read the JSON reply; if it is not JSON, carry on with an empty object
        return response.json().then(function (body) {
          // Pair the status code with the body
          return { status: response.status, body: body };
        }, function () {
          // Not JSON: keep only the status code
          return { status: response.status, body: {} };
        });
      }).then(function (result) {
        // Tell the host page what happened
        announce(result.status, result.body);
        // Success: replace the form with the thank-you message
        if (result.status === 201) {
          // Swap the form for the success text
          card.replaceChild(make('p', 'margin:0;font-size:14px;color:#15803d;', successMessage), form);
          // Done
          return;
        }
        // Any other result: let the visitor try again
        button.disabled = false;
        // The server rejected the input: show its first message
        if (result.status === 400) {
          // The first validation detail, if the server sent one
          var detail = result.body && result.body.details && result.body.details[0];
          // Show it, or a general message
          setStatus(detail && detail.message ? detail.message : 'Please check your answers and try again.', true);
        } else if (result.status === 429) {
          // Rate limited: tell the visitor when to try again
          var seconds = result.body && result.body.retry_after_seconds;
          // Show the message
          setStatus('Too many submissions. Please try again' + (seconds ? ' in ' + seconds + (seconds === 1 ? ' second.' : ' seconds.') : ' shortly.'), true);
        } else if (result.status === 404) {
          // The widget was deleted
          setStatus('This form is no longer available.', true);
        } else {
          // Anything else, including server errors
          setStatus('Something went wrong. Please try again.', true);
        }
      }).catch(function () {
        // The request itself failed: network down, or the browser blocked it
        announce(0, null);
        // Let the visitor try again
        button.disabled = false;
        // Show a plain message
        setStatus('Could not reach the server. Please try again.', true);
      });
    });

    // Put the form in the card
    card.appendChild(form);
    // Put the card in the container
    container.appendChild(card);
    // Helper that adds the finished widget to the page
    function mount() {
      // Add the container to the page
      document.body.appendChild(container);
    }
    // If the page body already exists, add the widget now
    if (document.body) {
      // Mount immediately
      mount();
    } else {
      // Otherwise wait until the page has been parsed
      document.addEventListener('DOMContentLoaded', mount);
    }
  }

  // Step 1: download the widget's public configuration (this endpoint allows any origin and is cached for 60 seconds)
  fetch(apiBase + '/api/widgets/' + widgetId + '/config').then(function (response) {
    // Treat any non-2xx status as a failure
    if (!response.ok) {
      // Jump to the catch handler below
      throw new Error('HTTP ' + response.status);
    }
    // Parse the JSON reply
    return response.json();
  }).then(function (widget) {
    // The reply must contain a config object
    if (!widget || typeof widget.config !== 'object' || widget.config === null) {
      // Jump to the catch handler below
      throw new Error('the widget configuration is invalid');
    }
    // Step 2: draw the widget
    render(widget.name, widget.config);
  }).catch(function (error) {
    // The widget cannot be shown; tell the site owner in the console and leave the page untouched
    console.error('FlyRank Widget: could not load widget ' + widgetId + ':', error);
  });
})();
