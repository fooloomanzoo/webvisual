// Graphs namespace
graphNS = (function() {
'use strict';
// Canvas and contexts
var can = document.getElementById('graph'),
	cxt = (can ? can.getContext('2d') : undefined),
	graph = $('#graph');

function showData() {
	// Hide the loading message
	$('#load').fadeOut(undefined, function() {
		// Show the data
		$('#data').fadeIn();
	});
}

function redraw() {
	if(graphNS.graph === undefined) return;

	// Clear the canvas
	cxt.clearRect(0, 0, can.width, can.height);

	// Draw the graph(s)
	if(graphNS.graph.length) {
		// It's an array of graphs
		for(var i=0; i<graphNS.graph.length; ++i) {
			graphNS.graph[i].Draw();
		}
	} else {
		// It's a single graph
		graphNS.graph.Draw();
	}
}

// Sets the width of the canvas
function setWidth(width) {
	if(graph) graph.attr('width', width);
}
// Sets the height of the canvas
function setHeight(height) {
	if(graph) graph.attr('height', height);
}

function defaultResize() {
	setWidth($('#canvasDiv').width());
	setHeight($('#canvasDiv').width()/2);
}

$(document).ready(function(){
	// Resize the canvas
	$(window).resize(function() {
		graphNS.graphResize();
		redraw();
	});
	// Resize for the beginning
	defaultResize();

	// Activate the hide-header function
	$('#hide-header').click(function() {
		$('#header').animate({
			height: 'hide',
			opacity: 'hide'
		}, 'slow');
	});
});

// This is the public stuff
return {
	showData: showData,
	graph: undefined,
	graphResize: defaultResize,
	redraw: redraw,
	setWidth: setWidth,
	setHeight: setHeight,
};

})();