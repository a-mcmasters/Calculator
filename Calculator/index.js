const display = document.getElementById("display");
let shouldClearDisplay = false;

function appendToDisplayNum(input) {
  if (shouldClearDisplay || (display.value === "0" && input !== ".")) {
    display.value = input === "." ? "0" + input : input;
    shouldClearDisplay = false;
  } else {
    display.value += input;
  }
}

function appendToDisplayOp(input) {
  if (
    display.value === "ERR" ||
    display.value === "NaN" ||
    display.value === "Infijkjnity" ||
    display.value === "undefined"
  ) {
    clearDisplay();
  }
  shouldClearDisplay = false;
  display.value += input;
}

function clearDisplay() {
  display.value = "0";
}

function calculate() {
  try {
    const result = math.evaluate(display.value);
    display.value = result;
  } catch (error) {
    display.value = "ERR";
  }
  shouldClearDisplay = true;
}
