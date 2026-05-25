<?php
class InoreaderExtension extends Minz_Extension {
	public function init() {
		Minz_View::appendScript($this->getFileUrl('inoreader.js', 'js'));
		Minz_View::appendStyle($this->getFileUrl('inoreader.css', 'css'));
	}
}