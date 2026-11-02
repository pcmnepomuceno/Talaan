// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { PasswordField, Select, Textarea, TextField } from "../../src/components/fields";

it("names the input by its label and marks Required", () => {
  render(<TextField label="Company" required />);
  const input = screen.getByRole("textbox", { name: "Company" });
  expect(input.getAttribute("aria-required")).toBe("true");
  expect(input.hasAttribute("required")).toBe(false);
  expect(screen.getByText("Required")).toBeTruthy();
});

it("links helper and error to the field and sets aria-invalid", () => {
  render(<TextField label="Monthly gross salary" helper="Enter the amount before tax" error="Enter a number" />);
  const input = screen.getByRole("textbox", { name: "Monthly gross salary" });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const described = input
    .getAttribute("aria-describedby")!
    .split(" ")
    .map((id) => document.getElementById(id)!.textContent);
  expect(described).toEqual(["Enter the amount before tax", "Enter a number"]);
});

it("has no aria-invalid or describedby without error or helper", () => {
  render(<TextField label="Company" />);
  const input = screen.getByRole("textbox");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  expect(input.hasAttribute("aria-describedby")).toBe(false);
});

it("renders prefix and suffix around the input", () => {
  render(<TextField label="Salary" prefix="₱" suffix="/ month" inputMode="numeric" />);
  expect(screen.getByText("₱")).toBeTruthy();
  expect(screen.getByText("/ month")).toBeTruthy();
  expect(screen.getByRole("textbox").getAttribute("inputmode")).toBe("numeric");
});

it("forwards ref and native props on every field", () => {
  const input = createRef<HTMLInputElement>();
  const password = createRef<HTMLInputElement>();
  const area = createRef<HTMLTextAreaElement>();
  const select = createRef<HTMLSelectElement>();
  render(
    <>
      <TextField ref={input} label="Email" type="email" name="email" autoComplete="email" />
      <PasswordField ref={password} label="Password" name="password" autoComplete="current-password" />
      <Textarea ref={area} label="Notes" name="remarks" maxLength={500} />
      <Select ref={select} label="Outcome" name="outcome" autoComplete="off">
        <option value="pending">Pending</option>
      </Select>
    </>,
  );
  expect(input.current).toBe(screen.getByRole("textbox", { name: "Email" }));
  expect(input.current!.getAttribute("autocomplete")).toBe("email");
  expect(input.current!.type).toBe("email");
  expect(password.current!.getAttribute("autocomplete")).toBe("current-password");
  expect(password.current!.name).toBe("password");
  expect(area.current).toBe(screen.getByRole("textbox", { name: "Notes" }));
  expect(area.current!.maxLength).toBe(500);
  expect(select.current).toBe(screen.getByRole("combobox", { name: "Outcome" }));
  expect(select.current!.name).toBe("outcome");
});

it("disabled field is not focusable", async () => {
  render(
    <>
      <TextField label="Off" disabled />
      <TextField label="On" />
    </>,
  );
  await userEvent.setup().tab();
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "On" }));
});

it("PasswordField toggles visibility with one eye button", async () => {
  render(<PasswordField label="Password" />);
  const user = userEvent.setup();
  const input = screen.getByLabelText("Password", { selector: "input" });
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(input.getAttribute("type")).toBe("password");

  await user.tab(); // input
  await user.tab(); // eye
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show password" }));
  await user.keyboard("{Enter}");
  expect(input.getAttribute("type")).toBe("text");
  expect(screen.getByRole("button", { name: "Hide password" })).toBe(document.activeElement);
  expect(screen.queryByText(/show/i)).toBeNull(); // no visible "Show" word
  await user.keyboard(" ");
  expect(input.getAttribute("type")).toBe("password");
});

it("Select shows the placeholder for an empty value and changes by keyboard", async () => {
  render(
    <Select label="Outcome" placeholder="Choose an outcome" defaultValue="">
      <option value="pending">Pending</option>
      <option value="good">Good</option>
    </Select>,
  );
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Outcome" });
  expect(select.value).toBe("");
  expect(select.selectedOptions[0].textContent).toBe("Choose an outcome");
  expect(select.getAttribute("aria-invalid")).toBeNull();

  const user = userEvent.setup();
  await user.selectOptions(select, "good");
  expect(select.value).toBe("good");
  select.focus();
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(select);
});

it("Textarea is named and reports errors", () => {
  render(<Textarea label="Notes" error="Too long" />);
  const area = screen.getByRole("textbox", { name: "Notes" });
  expect(area.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(area.getAttribute("aria-describedby")!)!.textContent).toBe("Too long");
});

// Caller ARIA props merge with the generated ones instead of being overwritten.
const ariaFields = {
  TextField: (p: Record<string, unknown>) => <TextField label="Field" {...p} />,
  PasswordField: (p: Record<string, unknown>) => <PasswordField label="Field" {...p} />,
  Textarea: (p: Record<string, unknown>) => <Textarea label="Field" {...p} />,
  Select: (p: Record<string, unknown>) => (
    <Select label="Field" {...p}>
      <option value="a">A</option>
    </Select>
  ),
};
const control = () => screen.getByLabelText("Field", { selector: "input, textarea, select" });

describe.each(Object.entries(ariaFields))("%s ARIA merge", (_, F) => {
  it("keeps the caller's aria-describedby alone", () => {
    render(<F aria-describedby="pw-rules" />);
    expect(control().getAttribute("aria-describedby")).toBe("pw-rules");
  });

  it("puts the caller's aria-describedby before helper and error", () => {
    render(<F id="f" aria-describedby="pw-rules" helper="Help" error="Wrong" />);
    expect(control().getAttribute("aria-describedby")).toBe("pw-rules f-helper f-error");
  });

  it("aria-invalid is true with an error, even if the caller says false", () => {
    render(<F error="Wrong" aria-invalid={false} />);
    expect(control().getAttribute("aria-invalid")).toBe("true");
  });

  it("respects the caller's aria-invalid without an error", () => {
    render(<F aria-invalid />);
    expect(control().getAttribute("aria-invalid")).toBe("true");
  });

  it("aria-required is true when required, even if the caller says false", () => {
    render(<F required aria-required={false} />);
    expect(control().getAttribute("aria-required")).toBe("true");
  });

  it("respects the caller's aria-required without required", () => {
    render(<F aria-required />);
    expect(control().getAttribute("aria-required")).toBe("true");
  });
});

it("Select placeholder cannot be picked again once a value is chosen", async () => {
  render(
    <Select label="Status" placeholder="Choose a status" defaultValue="">
      <option value="saved">Saved</option>
    </Select>,
  );
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Status" });
  const placeholder = screen.getByText<HTMLOptionElement>("Choose a status");
  expect(placeholder.disabled).toBe(true);
  expect(placeholder.hidden).toBe(true);
  expect(select.value).toBe(""); // still shown as the initial empty value

  const user = userEvent.setup();
  await user.selectOptions(select, "saved");
  await user.selectOptions(select, ""); // user-event skips disabled options, like the browser menu
  expect(select.value).toBe("saved");
});

it("Select passes required to the native element so an empty value is invalid", () => {
  render(
    <Select label="Status" placeholder="Choose a status" defaultValue="" required>
      <option value="saved">Saved</option>
    </Select>,
  );
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Status" });
  expect(select.required).toBe(true);
  expect(select.validity.valueMissing).toBe(true);
});
